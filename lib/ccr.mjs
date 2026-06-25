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

// Crea un almacén CCR aislado. `now` es inyectable para testear el TTL sin esperas reales.
export function createCcrStore(opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const entries = new Map();   // ref -> { content, type, chars, createdAt }
  const byHash = new Map();    // hash(content) -> ref, para reusar la misma referencia con el mismo contenido
  let counter = 0;
  let charsSaved = 0;

  const remove = (ref) => {
    const entry = entries.get(ref);
    if (!entry) return;
    entries.delete(ref);
    const hash = hashString(entry.content);
    if (byHash.get(hash) === ref) byHash.delete(hash);
  };
  const evict = () => {
    const t = now();
    for (const [ref, entry] of entries) if (t - entry.createdAt > cfg.ttlMs) remove(ref);
    while (entries.size > cfg.maxEntries) remove(entries.keys().next().value);   // FIFO: la más vieja primero
  };

  const nextRef = () => `c${(++counter).toString(36)}`;
  const preview = (str) => str.slice(0, cfg.previewChars).replace(/\s+/g, ' ').trim();
  const placeholder = (ref, type, str) => `[CCR ref=${ref} type=${JSON.stringify(String(type))} chars=${str.length} preview=${JSON.stringify(preview(str))}]`;

  return {
    // Compacta un string: si supera el umbral lo guarda y devuelve un placeholder; si no, lo devuelve intacto.
    // El mismo contenido reusa la MISMA referencia (refs estables, sin doble conteo del ahorro).
    compact(content, { type = 'text' } = {}) {
      const str = String(content ?? '');
      if (str.length <= cfg.threshold) return str;
      evict();
      const hash = hashString(str);
      let ref = byHash.get(hash);
      if (!(ref && entries.has(ref) && entries.get(ref).content === str)) {   // nuevo (o colisión/expirado): crea ref
        ref = nextRef();
        entries.set(ref, { content: str, type, chars: str.length, createdAt: now() });
        byHash.set(hash, ref);
        charsSaved += Math.max(0, str.length - placeholder(ref, type, str).length);
        evict(); // aplica maxEntries también inmediatamente después de insertar
      }
      return placeholder(ref, type, str);
    },

    // Recupera el original de una referencia. Devuelve null si no existe o expiró (TTL).
    recall(ref) {
      evict();
      const entry = entries.get(String(ref ?? ''));
      return entry ? entry.content : null;
    },

    has(ref) { return entries.has(String(ref ?? '')); },
    stats() { return { entries: entries.size, charsSaved }; }
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
