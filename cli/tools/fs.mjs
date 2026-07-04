// cli/tools/fs.mjs — herramientas de filesystem del agente, CONFINADAS a la raíz del proyecto.
// Lectura (read/list/grep) es inofensiva; escritura (write/edit) exige aprobación inyectada.
// Cada tool devuelve una observación estructurada; un fallo se reporta como { error } legible por el modelo
// (los throws los captura el loop). Cero dependencias: solo node:fs/node:path.

import { readFile, writeFile, appendFile, readdir, mkdir, stat } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { resolve, relative, isAbsolute, join, dirname } from 'node:path';

const MAX_READ = 256 * 1024;        // tope de lectura: evita cargar lockfiles/binarios gigantes en contexto
const MAX_GREP_MATCHES = 100;
const MAX_GREP_FILES = 2000;
const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.chalc']);

// realpath del ancestro EXISTENTE más profundo: al escribir, el archivo destino puede no existir aún,
// pero sus carpetas padre sí — y son ellas las que podrían ser un symlink/junction hacia fuera.
function deepestExistingRealpath(p) {
  let cur = p;
  for (;;) {
    try { return realpathSync(cur); } catch { /* no existe: sube un nivel */ }
    const parent = dirname(cur);
    if (parent === cur) return cur;   // llegó a la raíz del filesystem sin existir: se devuelve tal cual
    cur = parent;
  }
}

const escapes = (base, target) => {
  const rel = relative(base, target);
  return rel !== '' && (rel.split(/[\\/]/)[0] === '..' || isAbsolute(rel));
};

// Resuelve una ruta relativa DENTRO de la raíz. Lanza si intenta escapar (path traversal, otra unidad,
// o un symlink/junction dentro del proyecto que apunte fuera — el chequeo léxico solo no lo ve).
// El loop convierte ese throw en una observación de error, así el modelo se entera y no rompe nada.
export function resolveInRoot(root, p) {
  const abs = resolve(root, p || '.');
  const rel = relative(root, abs);
  const firstSegment = rel.split(/[\\/]/)[0];
  if (firstSegment === '..' || isAbsolute(rel)) throw new Error(`path outside the project: ${p}`);
  // Chequeo REAL: la ruta con symlinks resueltos (del tramo que existe) también debe caer dentro de la raíz real.
  if (escapes(deepestExistingRealpath(resolve(root)), deepestExistingRealpath(abs))) {
    throw new Error(`path outside the project (symlink): ${p}`);
  }
  return abs;
}

// Heurística de binario: un byte nulo en la cabecera. Evita volcar imágenes/ejecutables como "texto".
function isBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

// Tolerancia de argumentos: los modelos locales usan claves distintas (file, filename, content, text…).
// Se acepta la primera clave presente para no fallar por un sinónimo.
const pick = (args, keys) => { for (const k of keys) { const v = args?.[k]; if (v != null) return v; } return undefined; };
const argPath = (args) => pick(args, ['path', 'file', 'filename', 'filepath', 'file_path']);

// ——— Referencias locales fantasma ———————————————————————————————————————————————————————————
// Un archivo de código recién escrito puede referenciar vecinos que NO existen (templateUrl/styleUrls
// de Angular, imports relativos, lazy routes con import()). Eso compila-rompe y el modelo no se entera
// hasta el review (o nunca). Tras cada write/edit se verifican esas referencias y, si faltan, la
// observación lleva un `hint` para que el modelo las cree o corrija la ruta EN EL SIGUIENTE TURNO.
const REF_RES = [
  /['"`](\.[^'"`\n]*\.(?:css|scss|sass|less|html|htm))['"`]/g,   // plantillas/estilos relativos
  /\bfrom\s+['"`](\.[^'"`\n]+)['"`]/g,                           // import estático relativo
  /\bimport\(\s*['"`](\.[^'"`\n]+)['"`]\s*\)/g                   // import dinámico (lazy routes)
];
const ASSET_EXT = /\.(css|scss|sass|less|html|htm|json|svg)$/i;
const CODE_EXT = /\.(ts|tsx|js|mjs|cjs|jsx)$/i;
const MAX_REFS = 15;

export async function missingLocalRefs(absFile, content) {
  if (!CODE_EXT.test(absFile)) return [];
  const dir = dirname(absFile);
  const refs = new Set();
  for (const re of REF_RES) {
    for (const m of String(content).matchAll(re)) { refs.add(m[1]); if (refs.size >= MAX_REFS) break; }
  }
  const missing = [];
  for (const ref of refs) {
    const abs = resolve(dir, ref);
    // Con extensión explícita se exige exacta; un import sin extensión se resuelve como Node/TS.
    const candidates = ASSET_EXT.test(ref) || CODE_EXT.test(ref)
      ? [abs]
      : [`${abs}.ts`, `${abs}.tsx`, `${abs}.js`, `${abs}.mjs`, join(abs, 'index.ts'), abs];
    let found = false;
    for (const c of candidates) {
      try { if ((await stat(c)).isFile()) { found = true; break; } } catch { /* sigue probando */ }
    }
    if (!found) missing.push(ref);
  }
  return missing;
}

// ¿Contenido de código aparentemente INCOMPLETO? Llaves sin balancear = el modelo cortó el archivo
// (típico: "cierra" el JSON del turno sin terminar el contenido y el archivo queda sin la } final).
// Aviso, no bloqueo: puede haber llaves legítimas en strings; el modelo corrige en el turno siguiente.
export function braceDelta(text) {
  let open = 0;
  for (const ch of String(text)) { if (ch === '{') open++; else if (ch === '}') open--; }
  return open;
}

// ¿La ruta viola el mapa de carpetas de la arquitectura? layoutRoots viene del `## Folder map` del
// architecture.md que chalc mismo genera (p. ej. src/app/core|shared|features). Gobierna SOLO archivos
// en subcarpetas nuevas bajo el árbol común de esos roots; los archivos directos (app.routes.ts) y todo
// lo de fuera (src/main.ts, docs/…) no se opinan. Determinista: el modelo "olvida" la arquitectura,
// pero el path de un write no miente.
export function placementNote(relPath, layoutRoots = []) {
  if (!layoutRoots.length) return null;
  const p = String(relPath).replace(/\\/g, '/');
  const parents = [...new Set(layoutRoots.map((r) => r.replace(/\/[^/]+$/, '')))];   // src/app/core → src/app
  const parent = parents.find((base) => p.startsWith(base + '/'));
  if (!parent) return null;                                        // fuera del árbol mapeado: sin opinión
  const rest = p.slice(parent.length + 1);
  if (!rest.includes('/')) return null;                            // archivo directo en la base: permitido
  if (layoutRoots.some((r) => p.startsWith(r + '/'))) return null; // dentro de un root mapeado: correcto
  return `this path is OUTSIDE the architecture folder map (${layoutRoots.join(', ')}) — place the file under the correct mapped folder`;
}

// Avisos post-escritura para archivos de código: ubicación + referencias fantasma + truncamiento.
// Una sola clave `hint` (el modelo lee la observación completa; dos claves distintas diluyen la corrección).
async function writeHints(abs, text, relPath, layoutRoots) {
  if (!CODE_EXT.test(abs)) return {};
  const notes = [];
  const badPlace = placementNote(relPath, layoutRoots);
  if (badPlace) notes.push(badPlace);
  const delta = braceDelta(text);
  if (delta !== 0) notes.push(`the content looks INCOMPLETE (${delta > 0 ? delta + ' unclosed "{"' : Math.abs(delta) + ' extra "}"'}) — rewrite the file COMPLETE, or send the missing rest with {"append":true}`);
  const missing = await missingLocalRefs(abs, text);
  if (missing.length) notes.push(`this file references local files that do NOT exist: ${missing.join(', ')} — create them in the next steps or fix the reference`);
  return notes.length ? { hint: notes.join(' | ') } : {};
}

// Crea las tools de filesystem ligadas a `root`. `approve({tool,...}) -> boolean` autoriza las de escritura.
// layoutRoots (opcional): carpetas del Folder map de la arquitectura, para el aviso de ubicación.
export function createFsTools({ root, approve = async () => true, layoutRoots = [] }) {
  if (!root) throw new Error('createFsTools requiere root.');

  // Listado de un directorio (compartido por list y por el auto-delegado de read).
  const listEntries = async (abs) => (await readdir(abs, { withFileTypes: true }))
    .filter((e) => !IGNORE_DIRS.has(e.name))
    .map((e) => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file' }));

  const read = {
    summary: 'Reads a text file. args: { path }',
    run: async (args = {}) => {
      const path = argPath(args);
      if (typeof path !== 'string' || !path.trim()) return { error: 'missing "path" (file path)' };
      const abs = resolveInRoot(root, path);
      let st;
      try { st = await stat(abs); } catch { return { path, error: 'does not exist' }; }
      // read sobre un DIRECTORIO: la intención es inequívoca (quiere el listado) — se auto-delega a list
      // en vez de devolver un error que los modelos chicos repiten en bucle hasta el cortacircuito.
      if (st.isDirectory()) {
        try {
          return { path, note: 'this is a directory (auto-listed); use list for directories', entries: await listEntries(abs) };
        } catch { return { path, error: 'not a readable directory' }; }
      }
      if (st.size > MAX_READ) return { path, size: st.size, error: `large file (${st.size} bytes); use grep to search inside` };
      const buf = await readFile(abs);
      if (isBinary(buf)) return { path, error: 'binary; not text' };
      return { path, content: buf.toString('utf8') };
    }
  };

  const list = {
    summary: 'Lists a directory. args: { path? }',
    run: async (args = {}) => {
      const path = argPath(args) || '.';
      const abs = resolveInRoot(root, path);
      try { return { path, entries: await listEntries(abs) }; } catch { return { path, error: 'not a readable directory' }; }
    }
  };

  const grep = {
    summary: 'Searches a regex pattern in the project text files. args: { pattern, path? }',
    run: async (args = {}) => {
      const pattern = pick(args, ['pattern', 'query', 'regex', 'q', 'text', 'search', 'find', 'term', 'keyword', 'string']);
      const path = argPath(args) || '.';
      // Ejemplo copiable en el error: los modelos locales se corrigen imitando, no leyendo descripciones.
      if (typeof pattern !== 'string' || !pattern) return { error: 'missing "pattern" — send e.g. {"action":{"tool":"grep","args":{"pattern":"users","path":"src/app"}}}' };
      let re;
      try { re = new RegExp(pattern); } catch (e) { return { error: `invalid regex: ${e.message}` }; }
      const matches = [];
      let filesScanned = 0;

      const scanFile = async (abs) => {
        let buf;
        try {
          const st = await stat(abs);
          if (st.size > MAX_READ) return;
          buf = await readFile(abs);
        } catch { return; }
        if (isBinary(buf)) return;
        const rel = relative(root, abs);
        const lines = buf.toString('utf8').split(/\r?\n/);
        for (let i = 0; i < lines.length && matches.length < MAX_GREP_MATCHES; i++) {
          if (re.test(lines[i])) matches.push({ file: rel, line: i + 1, text: lines[i].slice(0, 240) });
        }
      };

      const walk = async (dir) => {
        if (matches.length >= MAX_GREP_MATCHES || filesScanned >= MAX_GREP_FILES) return;
        let entries;
        try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
          if (matches.length >= MAX_GREP_MATCHES || filesScanned >= MAX_GREP_FILES) break;
          const full = join(dir, e.name);
          if (e.isDirectory()) {
            if (!IGNORE_DIRS.has(e.name) && !e.name.startsWith('.')) await walk(full);
          } else if (e.isFile()) {
            filesScanned++;
            await scanFile(full);
          }
        }
      };

      const baseAbs = resolveInRoot(root, path);
      const st = await stat(baseAbs).catch(() => null);
      if (!st) return { pattern, error: 'path not found' };
      if (st.isFile()) { filesScanned++; await scanFile(baseAbs); } else await walk(baseAbs);
      return { pattern, matches, truncated: matches.length >= MAX_GREP_MATCHES };
    }
  };

  const write = {
    summary: 'Creates or overwrites a file (requires approval). Use it to create files, NOT bash. If the content is long, write it in parts: a first normal write, then writes with "append":true. args: { path, content, append? }',
    run: async (args = {}) => {
      const path = argPath(args);
      const content = String(pick(args, ['content', 'contents', 'text', 'body', 'data']) ?? '');
      // append tolerante: true booleano o "true" string (los modelos locales mandan ambos).
      const rawAppend = pick(args, ['append']);
      const append = rawAppend === true || String(rawAppend).toLowerCase() === 'true';
      if (typeof path !== 'string' || !path.trim()) return { error: 'missing "path" (file to write) — send e.g. {"action":{"tool":"write","args":{"path":"src/app/x.ts","content":"..."}}}' };
      const abs = resolveInRoot(root, path);
      // Candado ANTI-BORRADO: un write sin contenido (o casi vacío) sobre un archivo existente con
      // contenido es casi siempre un accidente destructivo (el modelo olvidó el campo "content" o su
      // salida vino truncada) — se RECHAZA antes de tocar el disco, con instrucciones para corregir.
      // Visto en vivo: gpt-oss "corrigió" un componente escribiéndolo con 0 bytes y ok:true.
      if (!append && !content.trim()) {
        const prev = await stat(abs).catch(() => null);
        if (prev && prev.isFile() && prev.size > 0) {
          return { path, error: `refused: this write has EMPTY content but ${path} already exists with ${prev.size} bytes — that would DESTROY the file. Send the FULL new content in "content", or use edit for a surgical change.` };
        }
      }
      if (!(await approve({ tool: 'write', args: { path, content, append } }))) return { path, error: 'action not approved by the user' };
      // Aviso de ENCOGIMIENTO drástico: reemplazar un archivo por <25% de su tamaño anterior suele ser
      // una regeneración incompleta (no un refactor) — se ejecuta, pero el aviso viaja en la observación.
      let shrankNote = null;
      if (!append) {
        const prev = await stat(abs).catch(() => null);
        if (prev && prev.isFile() && prev.size >= 400 && content.length < prev.size / 4) {
          shrankNote = `this write SHRANK ${path} from ${prev.size} to ${content.length} bytes — if you did not intend to delete most of the file, rewrite it with the FULL content`;
        }
      }
      await mkdir(dirname(abs), { recursive: true });
      if (append) await appendFile(abs, content);
      else await writeFile(abs, content);
      // En append los avisos se calculan sobre el archivo COMPLETO (el trozo solo puede estar cortado).
      const finalText = append ? await readFile(abs, 'utf8') : content;
      const hints = await writeHints(abs, finalText, path, layoutRoots);
      if (shrankNote) hints.hint = hints.hint ? `${shrankNote} | ${hints.hint}` : shrankNote;
      return { path, bytes: content.length, ...(append ? { appended: true } : {}), ok: true, ...hints };
    }
  };

  const edit = {
    summary: 'Replaces ONE exact match in an existing file (requires approval). args: { path, old, new }',
    run: async (args = {}) => {
      const path = argPath(args);
      const oldStr = pick(args, ['old', 'oldText', 'oldString', 'old_string', 'search', 'find']);
      const newStr = String(pick(args, ['new', 'newText', 'newString', 'new_string', 'replace', 'replacement']) ?? '');
      if (typeof path !== 'string' || !path.trim()) return { error: 'missing "path" (file path)' };
      if (typeof oldStr !== 'string' || oldStr === '') return { path, error: 'missing "old" (exact text to replace)' };
      const abs = resolveInRoot(root, path);
      let text;
      try { text = await readFile(abs, 'utf8'); } catch { return { path, error: 'does not exist' }; }
      const occurrences = text.split(oldStr).length - 1;
      if (occurrences === 0) return { path, error: '"old" was not found in the file' };
      if (occurrences > 1) return { path, error: `"old" appears ${occurrences} times; add context to make it unique` };
      if (!(await approve({ tool: 'edit', args: { path, old: oldStr, new: newStr } }))) return { path, error: 'action not approved by the user' };
      const finalText = text.replace(oldStr, newStr);
      await writeFile(abs, finalText);
      return { path, ok: true, ...(await writeHints(abs, finalText, path, layoutRoots)) };
    }
  };

  return { read, list, grep, write, edit };
}
