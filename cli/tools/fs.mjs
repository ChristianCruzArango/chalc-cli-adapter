// cli/tools/fs.mjs — herramientas de filesystem del agente, CONFINADAS a la raíz del proyecto.
// Lectura (read/list/grep) es inofensiva; escritura (write/edit) exige aprobación inyectada.
// Cada tool devuelve una observación estructurada; un fallo se reporta como { error } legible por el modelo
// (los throws los captura el loop). Cero dependencias: solo node:fs/node:path.

import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';
import { lineMatcher, RegexTimeoutError } from '../../lib/saferegex.mjs';
import { redactSecretFile } from '../../lib/redact.mjs';
import { resolveInRoot, assertNotGitDir, writeConfined, realRelative, pathAndReal } from './fsconfine.mjs';
import { writeHints } from './fshints.mjs';

export { resolveInRoot } from './fsconfine.mjs';
export { missingLocalRefs, braceDelta, placementNote } from './fshints.mjs';

const MAX_READ = 256 * 1024;        // tope de lectura: evita cargar lockfiles/binarios gigantes en contexto
const MAX_GREP_MATCHES = 100;
const MAX_GREP_FILES = 2000;
const GREP_BUDGET_MS = 5000;        // tope de tiempo de un grep entero; al pasarlo se devuelve lo hallado
const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.chalc']);

// Heurística de binario: un byte nulo en la cabecera (los primeros BINARY_SNIFF_BYTES). Evita volcar
// imágenes/ejecutables como "texto".
const BINARY_SNIFF_BYTES = 8000;
function isBinary(buf) {
  const n = Math.min(buf.length, BINARY_SNIFF_BYTES);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

// Tolerancia de argumentos: los modelos locales usan claves distintas (file, filename, content, text…).
// Se acepta la primera clave presente para no fallar por un sinónimo.
const pick = (args, keys) => { for (const k of keys) { const v = args?.[k]; if (v != null) return v; } return undefined; };
const argPath = (args) => pick(args, ['path', 'file', 'filename', 'filepath', 'file_path']);

// Listado de un directorio (compartido por list y por el auto-delegado de read).
const listEntries = async (abs) => (await readdir(abs, { withFileTypes: true }))
  .filter((e) => !IGNORE_DIRS.has(e.name))
  .map((e) => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file' }));

// read sobre un DIRECTORIO: la intención es inequívoca (quiere el listado) — se auto-delega a list
// en vez de devolver un error que los modelos chicos repiten en bucle hasta el cortacircuito.
async function autoListed(abs, path) {
  try {
    return { path, note: 'this is a directory (auto-listed); use list for directories', entries: await listEntries(abs) };
  } catch { return { path, error: 'not a readable directory' }; }
}

function readTool(root) {
  return {
    summary: 'Reads a text file. args: { path }',
    run: async (args = {}) => {
      const path = argPath(args);
      if (typeof path !== 'string' || !path.trim()) return { error: 'missing "path" (file path)' };
      const abs = resolveInRoot(root, path);
      let st;
      try { st = await stat(abs); } catch { return { path, error: 'does not exist' }; }
      if (st.isDirectory()) return autoListed(abs, path);
      if (st.size > MAX_READ) return { path, size: st.size, error: `large file (${st.size} bytes); use grep to search inside` };
      const buf = await readFile(abs);
      if (isBinary(buf)) return { path, error: 'binary; not text' };
      // Un `.env`, una clave o un archivo de credenciales ES una lista de secretos: se ve su forma, no sus
      // valores. Se mira la ruta pedida Y la real: un enlace `notes.txt -> .env` es un `.env` (V-04).
      return { path, content: redactSecretFile(buf.toString('utf8'), pathAndReal(root, path)) };
    }
  };
}

function listTool(root) {
  return {
    summary: 'Lists a directory. args: { path? }',
    run: async (args = {}) => {
      const path = argPath(args) || '.';
      const abs = resolveInRoot(root, path);
      try { return { path, entries: await listEntries(abs) }; } catch { return { path, error: 'not a readable directory' }; }
    }
  };
}

// Un grep en curso: lo hallado y sus topes (coincidencias, archivos y tiempo).
function grepRun(root, match) {
  const g = { matches: [], filesScanned: 0, deadline: Date.now() + GREP_BUDGET_MS, outOfTime: false };
  g.done = () => g.matches.length >= MAX_GREP_MATCHES || g.filesScanned >= MAX_GREP_FILES || g.outOfTime;
  g.scanFile = async (abs) => {
    let buf;
    try {
      const st = await stat(abs);
      if (st.size > MAX_READ) return;
      buf = await readFile(abs);
    } catch { return; }
    if (isBinary(buf)) return;
    const rel = relative(root, abs);
    const paths = pathAndReal(root, rel);
    const lines = buf.toString('utf8').split(/\r?\n/);
    const hits = match(lines);
    for (let i = 0; i < lines.length && g.matches.length < MAX_GREP_MATCHES; i++) {
      if (hits[i]) g.matches.push({ file: rel, line: i + 1, text: redactSecretFile(lines[i], paths).slice(0, 240) });
    }
    if (Date.now() > g.deadline) g.outOfTime = true;
  };
  g.walk = async (dir) => {
    if (g.done()) return;
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (g.done()) break;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (!IGNORE_DIRS.has(e.name) && !e.name.startsWith('.')) await g.walk(full);
      } else if (e.isFile()) {
        g.filesScanned++;
        await g.scanFile(full);
      }
    }
  };
  return g;
}

function grepTool(root) {
  return {
    summary: 'Searches the project text files. Plain text is matched literally; a pattern with regex syntax is a JS regex. args: { pattern, path? }',
    run: async (args = {}) => {
      const pattern = pick(args, ['pattern', 'query', 'regex', 'q', 'text', 'search', 'find', 'term', 'keyword', 'string']);
      const path = argPath(args) || '.';
      // Ejemplo copiable en el error: los modelos locales se corrigen imitando, no leyendo descripciones.
      if (typeof pattern !== 'string' || !pattern) return { error: 'missing "pattern" — send e.g. {"action":{"tool":"grep","args":{"pattern":"users","path":"src/app"}}}' };
      // Literal si no hay sintaxis de regex; si la hay, se evalúa con tiempo acotado (lib/saferegex):
      // el patrón lo escribe el modelo, y un `(a+)+$` bloquearía el event loop sin que ESC lo pare.
      let match;
      try { match = lineMatcher(pattern); } catch (e) { return { error: `invalid regex: ${e.message}` }; }
      const g = grepRun(root, match);
      const baseAbs = resolveInRoot(root, path);
      const st = await stat(baseAbs).catch(() => null);
      if (!st) return { pattern, error: 'path not found' };
      try {
        if (st.isFile()) { g.filesScanned++; await g.scanFile(baseAbs); } else await g.walk(baseAbs);
      } catch (e) {
        if (e instanceof RegexTimeoutError) return { pattern, error: `${e.message} — use a simpler pattern or plain text` };
        throw e;
      }
      return { pattern, matches: g.matches, truncated: g.matches.length >= MAX_GREP_MATCHES || g.outOfTime };
    }
  };
}

// Candado ANTI-BORRADO: un write sin contenido (o casi vacío) sobre un archivo existente con
// contenido es casi siempre un accidente destructivo (el modelo olvidó el campo "content" o su
// salida vino truncada) — se RECHAZA antes de tocar el disco, con instrucciones para corregir.
// Visto en vivo: gpt-oss "corrigió" un componente escribiéndolo con 0 bytes y ok:true.
async function emptyWriteRefusal(abs, path) {
  const prev = await stat(abs).catch(() => null);
  if (!prev || !prev.isFile() || prev.size === 0) return null;
  return { path, error: `refused: this write has EMPTY content but ${path} already exists with ${prev.size} bytes — that would DESTROY the file. Send the FULL new content in "content", or use edit for a surgical change.` };
}

// Aviso de ENCOGIMIENTO drástico: reemplazar un archivo por <25% de su tamaño anterior suele ser
// una regeneración incompleta (no un refactor) — se ejecuta, pero el aviso viaja en la observación.
async function shrinkNote(abs, path, content) {
  const prev = await stat(abs).catch(() => null);
  if (!prev || !prev.isFile() || prev.size < 400 || content.length >= prev.size / 4) return null;
  return `this write SHRANK ${path} from ${prev.size} to ${content.length} bytes — if you did not intend to delete most of the file, rewrite it with the FULL content`;
}

function writeTool(root, approve, layoutRoots) {
  return {
    summary: 'Creates or overwrites a file (requires approval). Use it to create files, NOT bash. If the content is long, write it in parts: a first normal write, then writes with "append":true. args: { path, content, append? }',
    run: async (args = {}) => {
      const path = argPath(args);
      const content = String(pick(args, ['content', 'contents', 'text', 'body', 'data']) ?? '');
      // append tolerante: true booleano o "true" string (los modelos locales mandan ambos).
      const rawAppend = pick(args, ['append']);
      const append = rawAppend === true || String(rawAppend).toLowerCase() === 'true';
      if (typeof path !== 'string' || !path.trim()) return { error: 'missing "path" (file to write) — send e.g. {"action":{"tool":"write","args":{"path":"src/app/x.ts","content":"..."}}}' };
      const abs = resolveInRoot(root, path);
      assertNotGitDir(resolve(root), path, abs);
      if (!append && !content.trim()) {
        const refusal = await emptyWriteRefusal(abs, path);
        if (refusal) return refusal;
      }
      if (!(await approve({ tool: 'write', args: { path, content, append, realPath: realRelative(root, abs) } }))) return { path, error: 'action not approved by the user' };
      const shrankNote = append ? null : await shrinkNote(abs, path, content);
      const target = await writeConfined(root, path, content, { append });
      // En append los avisos se calculan sobre el archivo COMPLETO (el trozo solo puede estar cortado).
      const finalText = append ? await readFile(target, 'utf8') : content;
      const hints = await writeHints(abs, finalText, path, layoutRoots);
      if (shrankNote) hints.hint = hints.hint ? `${shrankNote} | ${hints.hint}` : shrankNote;
      return { path, bytes: content.length, ...(append ? { appended: true } : {}), ok: true, ...hints };
    }
  };
}

function editTool(root, approve, layoutRoots) {
  return {
    summary: 'Replaces ONE exact match in an existing file (requires approval). args: { path, old, new }',
    run: async (args = {}) => {
      const path = argPath(args);
      const oldStr = pick(args, ['old', 'oldText', 'oldString', 'old_string', 'search', 'find']);
      const newStr = String(pick(args, ['new', 'newText', 'newString', 'new_string', 'replace', 'replacement']) ?? '');
      if (typeof path !== 'string' || !path.trim()) return { error: 'missing "path" (file path)' };
      if (typeof oldStr !== 'string' || oldStr === '') return { path, error: 'missing "old" (exact text to replace)' };
      const abs = resolveInRoot(root, path);
      assertNotGitDir(resolve(root), path, abs);
      let text;
      try { text = await readFile(abs, 'utf8'); } catch { return { path, error: 'does not exist' }; }
      const occurrences = text.split(oldStr).length - 1;
      if (occurrences === 0) return { path, error: '"old" was not found in the file' };
      if (occurrences > 1) return { path, error: `"old" appears ${occurrences} times; add context to make it unique` };
      if (!(await approve({ tool: 'edit', args: { path, old: oldStr, new: newStr, realPath: realRelative(root, abs) } }))) return { path, error: 'action not approved by the user' };
      // Mientras se esperaba la aprobación, alguien pudo cambiar (o borrar) el archivo: escribir la copia
      // vieja transformada borraría su cambio sin decirlo (C-01). Se relee y, si difiere, no se escribe.
      // Antes de releer se vuelve a confinar: si lo cambiaron por un enlace hacia fuera, se rechaza como
      // siempre (y no se lee el archivo ajeno).
      resolveInRoot(root, path);
      if ((await readFile(abs, 'utf8').catch(() => null)) !== text) {
        return { path, conflict: true, error: 'the file changed while waiting for approval; read it again and redo the edit' };
      }
      // Función de reemplazo: con un string, `$&`, `$$`, `` $` `` y `$'` se interpretarían como patrones.
      const finalText = text.replace(oldStr, () => newStr);
      await writeConfined(root, path, finalText);
      return { path, ok: true, ...(await writeHints(abs, finalText, path, layoutRoots)) };
    }
  };
}

// Crea las tools de filesystem ligadas a `root`. `approve({tool,...}) -> boolean` autoriza las de escritura.
// layoutRoots (opcional): carpetas del Folder map de la arquitectura, para el aviso de ubicación.
export function createFsTools({ root, approve = async () => true, layoutRoots = [] }) {
  if (!root) throw new Error('createFsTools requiere root.');
  return {
    read: readTool(root),
    list: listTool(root),
    grep: grepTool(root),
    write: writeTool(root, approve, layoutRoots),
    edit: editTool(root, approve, layoutRoots)
  };
}
