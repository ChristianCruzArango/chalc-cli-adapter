// report-find.mjs — dónde está el reporte de mutación y si es de esta corrida. Responsabilidad ÚNICA:
// resolver la ruta (glob incluido) del reporte más reciente y el fuente más nuevo con que compararlo.
// Razón de cambio: cómo nombran y dónde dejan sus reportes las herramientas.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.

import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { REPORT_SKIP_DIRS } from './dirs.mjs';

// Directorios que jamás contienen un reporte y sí millones de archivos.
const SKIP_DIRS = REPORT_SKIP_DIRS;

export const mtimeOf = async (abs) => (await stat(abs)).mtimeMs;

// ── resolución del reporte ────────────────────────────────────────────────────────────────────
// La ruta del reporte puede ser un glob: Stryker.NET escribe en un directorio con marca de tiempo
// por corrida y PIT hace lo mismo. Entre varias coincidencias gana la MÁS RECIENTE — quedarse con la
// primera del listado sería leer el reporte de una corrida anterior, justo lo que R4 persigue.

const RE_SPECIALS = /[.+^${}()|[\]\\]/g;

// Marcas intermedias: los comodines se apartan ANTES de traducir `*` suelto, para que una traducción
// no se coma a la otra. Se eligen cadenas que no pueden aparecer en una ruta ni en el regex parcial.
const ANY_DIRS = '\u0000dirs\u0000';
const ANY_TEXT = '\u0000text\u0000';

// Glob → regex sobre rutas relativas con '/'. Solo `**` y `*`; no hay más en las rutas del catálogo.
function globToRegExp(pattern) {
  const source = pattern
    .replace(RE_SPECIALS, '\\$&')
    .replace(/\*\*\//g, ANY_DIRS)      // `**/` cruza cero o más directorios
    .replace(/\*\*/g, ANY_TEXT)
    .replace(/\*/g, '[^/]*')           // `*` suelto no cruza directorios
    .split(ANY_DIRS).join('(?:.*/)?')
    .split(ANY_TEXT).join('.*');
  return new RegExp(`^${source}$`);
}

// Los segmentos fijos antes del primer comodín: se camina desde ahí y no desde la raíz del repo.
function staticPrefix(pattern) {
  const segments = pattern.split('/');
  const first = segments.findIndex((s) => s.includes('*'));
  return first < 0 ? segments.slice(0, -1).join('/') : segments.slice(0, first).join('/');
}

// Archivos bajo `rel`, en rutas relativas a la raíz del repo.
async function walk(root, rel) {
  const out = [];
  let entries;
  try { entries = await readdir(join(root, rel), { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) out.push(...await walk(root, child));
    } else out.push(child);
  }
  return out;
}

// Ruta absoluta del reporte más reciente que encaja con `pattern`, o null si no hay ninguno.
export async function resolveReport(root, pattern) {
  if (!pattern) return null;
  if (!pattern.includes('*')) {
    const abs = join(root, pattern);
    try { await stat(abs); return abs; } catch { return null; }
  }

  const re = globToRegExp(pattern);
  const matches = (await walk(root, staticPrefix(pattern))).filter((rel) => re.test(rel));
  let newest = null;
  for (const rel of matches) {
    const abs = join(root, rel);
    const ms = await mtimeOf(abs);
    if (!newest || ms > newest.ms) newest = { abs, ms };
  }
  return newest ? newest.abs : null;
}

// ── frescura ──────────────────────────────────────────────────────────────────────────────────

// El fuente más nuevo de los que entraron en la corrida. null si no se pasó ninguno: sin fuentes no
// hay con qué comparar y la comprobación no aplica.
export async function newestSource(root, changed) {
  let newest = null;
  for (const rel of changed) {
    try {
      const ms = await mtimeOf(join(root, rel));
      if (!newest || ms > newest.ms) newest = { rel, ms };
    } catch { /* borrado en la tarea: ya no es fuente de la corrida */ }
  }
  return newest;
}
