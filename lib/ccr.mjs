// lib/ccr.mjs — CCR (Compresión Reversible / Reversible Content Reference).
// Idea tomada de Headroom: el contenido voluminoso (respuestas HTTP, DOM, logs) se reemplaza por una
// referencia compacta [CCR ref=...]; el original se guarda en una caché local con TTL y se recupera
// bajo demanda con recall(ref). Reversible mientras la referencia siga viva dentro de su TTL.
//
// Provider-agnóstico POR DISEÑO: opera sobre texto del prompt, no sobre el SDK de ningún proveedor.
// Funciona igual con Anthropic, OpenRouter, OpenAI, Google y Ollama, porque la referencia es texto y
// el recall es una acción JSON normal del agente — no un tool nativo atado a un proveedor.

const DEFAULTS = {
  threshold: 600,        // umbral en caracteres: por debajo de esto NO se comprime (no vale la pena la referencia)
  previewChars: 160,     // cuánto del original se deja visible en el placeholder
  ttlMs: 30 * 60 * 1000, // cuánto vive el original en caché antes de expirar
  maxEntries: 200        // tope de entradas; se evicta la más vieja (FIFO) al excederlo
};

// Hash barato (FNV-1a 32-bit) para memoizar contenido → referencia y dar refs estables entre turnos.
function hashString(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { hash ^= str.charCodeAt(i); hash = Math.imul(hash, 0x01000193); }
  return (hash >>> 0).toString(36);
}

function removeEntry(entries, byHash, ref) {
  const entry = entries.get(ref);
  if (!entry) return;
  entries.delete(ref);
  const hash = hashString(entry.content);
  if (byHash.get(hash) === ref) byHash.delete(hash);
}

// Quita lo que superó el TTL y, si aún sobran, las más viejas primero (FIFO).
function evictEntries(entries, byHash, t, cfg) {
  for (const [ref, entry] of entries) if (t - entry.createdAt > cfg.ttlMs) removeEntry(entries, byHash, ref);
  while (entries.size > cfg.maxEntries) removeEntry(entries, byHash, entries.keys().next().value);
}

function placeholderOf(ref, type, str, previewChars) {
  const preview = str.slice(0, previewChars).replace(/\s+/g, ' ').trim();
  return `[CCR ref=${ref} type=${JSON.stringify(String(type))} chars=${str.length} preview=${JSON.stringify(preview)}]`;
}

// Crea un almacén CCR aislado. `now` es inyectable para testear el TTL sin esperas reales.
// Guarda `str` bajo una referencia: la que ya tenía si es el mismo contenido (refs estables, sin doble
// conteo del ahorro), o una nueva si es nuevo, chocó el hash o expiró.
function storeEntry(st, str, type) {
  const hash = hashString(str);
  const ref = st.byHash.get(hash);
  if (ref && st.entries.has(ref) && st.entries.get(ref).content === str) return ref;
  const fresh = `c${(++st.counter).toString(36)}`;
  st.entries.set(fresh, { content: str, type, chars: str.length, createdAt: st.now() });
  st.byHash.set(hash, fresh);
  st.charsSaved += Math.max(0, str.length - placeholderOf(fresh, type, str, st.cfg.previewChars).length);
  evictEntries(st.entries, st.byHash, st.now(), st.cfg);   // aplica maxEntries también inmediatamente después de insertar
  return fresh;
}

export function createCcrStore(opts = {}) {
  const st = {
    cfg: { ...DEFAULTS, ...opts },
    now: typeof opts.now === 'function' ? opts.now : () => Date.now(),
    entries: new Map(),   // ref -> { content, type, chars, createdAt }
    byHash: new Map(),    // hash(content) -> ref, para reusar la misma referencia con el mismo contenido
    counter: 0,
    charsSaved: 0
  };
  const evict = () => evictEntries(st.entries, st.byHash, st.now(), st.cfg);

  return {
    // Compacta un string: si supera el umbral lo guarda y devuelve un placeholder; si no, lo devuelve intacto.
    compact(content, { type = 'text' } = {}) {
      const str = String(content ?? '');
      if (str.length <= st.cfg.threshold) return str;
      evict();
      return placeholderOf(storeEntry(st, str, type), type, str, st.cfg.previewChars);
    },

    // Recupera el original de una referencia. Devuelve null si no existe o expiró (TTL).
    recall(ref) {
      evict();
      const entry = st.entries.get(String(ref ?? ''));
      return entry ? entry.content : null;
    },

    has(ref) { return st.entries.has(String(ref ?? '')); },
    stats() { return { entries: st.entries.size, charsSaved: st.charsSaved }; }
  };
}

// Compacta recursivamente los strings grandes dentro de un objeto (p. ej. una observación del agente).
// Los campos pequeños (status, ok, request) quedan intactos; solo los voluminosos se vuelven referencias.
export function compactObject(store, value, type = 'observation') {
  if (typeof value === 'string') return store.compact(value, { type });
  if (Array.isArray(value)) return value.map((item) => compactObject(store, item, type));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(value)) out[key] = compactObject(store, val, key);
    return out;
  }
  return value;   // números, booleanos, null: no se comprimen
}
