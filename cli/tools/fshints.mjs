// cli/tools/fshints.mjs — avisos que viajan en la observación tras escribir un archivo: referencias
// locales que no existen, llaves descuadradas y archivos fuera del mapa de carpetas de la arquitectura.

import { stat } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';

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
export async function writeHints(abs, text, relPath, layoutRoots) {
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
