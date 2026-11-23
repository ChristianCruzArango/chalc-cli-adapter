// spec.mjs — la spec vigente del repo. Responsabilidad ÚNICA: decir cuál de las carpetas de
// `specs/` es la que se está implementando. Razón de cambio: cómo se organizan las specs.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// La vigente es la de número más alto: el flujo de chalc crea la carpeta y sobre esa se trabaja. Con varias
// specs a la vez (una por worktree), cada árbol fija la suya en `.chalc/active-spec` (spec 024, R1).

import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const NUMBERED = /^(\d+)-/;
// Un nombre de carpeta de spec, sin separadores: lo único que `.chalc/active-spec` puede nombrar.
const SPEC_NAME = /^\d+-[^/\\]+$/;
export const ACTIVE_SPEC_REL = '.chalc/active-spec';

const byNumberDesc = (a, b) => Number(NUMBERED.exec(b.name)[1]) - Number(NUMBERED.exec(a.name)[1]);

async function numberedDirs(root, specDir) {
  let entries;
  try { entries = await readdir(join(root, specDir), { withFileTypes: true }); } catch { return []; }
  return entries.filter((e) => e.isDirectory() && NUMBERED.test(e.name)).sort(byNumberDesc);
}

const isDirectory = async (path) => { try { return (await stat(path)).isDirectory(); } catch { return false; } };

// La carpeta que fija `.chalc/active-spec`: su primera línea, con o sin el prefijo `<specDir>/`.
// Devuelve undefined si el archivo no existe, y '' si existe pero no nombra una carpeta de spec real.
async function pinnedDir(root, specDir) {
  let text;
  try { text = await readFile(join(root, ...ACTIVE_SPEC_REL.split('/')), 'utf8'); } catch { return undefined; }
  const line = text.split(/\r?\n/)[0].trim();
  const name = line.startsWith(`${specDir}/`) ? line.slice(specDir.length + 1) : line;
  return SPEC_NAME.test(name) && await isDirectory(join(root, specDir, name)) ? `${specDir}/${name}` : '';
}

// La carpeta ACTIVA (spec 024, R1, R25): la fijada o, sin fijar, la de número más alto. Devuelve
// { dir, problem, pinned }. Una fijada que no existe es un problema, NO un motivo para tomar otra:
// trabajar en silencio sobre la spec equivocada es justo lo que esto evita.
export async function activeSpecDir(root, specDir) {
  const pin = await pinnedDir(root, specDir);
  if (pin !== undefined) return { dir: pin || null, problem: pin ? '' : 'active-spec-invalid', pinned: true };
  const newest = (await numberedDirs(root, specDir))[0];
  return { dir: newest ? `${specDir}/${newest.name}` : null, problem: newest ? '' : 'no-spec', pinned: false };
}

// `name` leído SOLO de la carpeta activa: { dir, path, text } o null si no hay carpeta o le falta (R2).
export async function activeSpecFile(root, specDir, name) {
  const { dir } = await activeSpecDir(root, specDir);
  if (!dir) return null;
  const path = `${dir}/${name}`;
  try { return { dir, path, text: await readFile(join(root, path), 'utf8') }; } catch { return null; }
}

// Todas las carpetas de spec que contienen `requires`, de la más reciente a la más antigua, con el
// contenido de ese archivo. Devuelve [{ dir, path, text }].
//
// Existe porque no todo se resuelve contra la spec vigente. Lo que se implementa hoy sale de ella,
// pero un test cambiado puede cubrir legítimamente un requisito de una spec anterior; sin poder
// mirarlas todas, esa cita correcta se reporta como inventada.
export async function everySpec(root, specDir, requires) {
  const found = [];
  for (const entry of await numberedDirs(root, specDir)) {
    const path = `${specDir}/${entry.name}/${requires}`;
    try {
      found.push({ dir: `${specDir}/${entry.name}`, path, text: await readFile(join(root, path), 'utf8') });
    } catch { /* esta carpeta no tiene ese archivo: se prueba la siguiente */ }
  }
  return found;
}

// Carpeta de spec más reciente que contiene `requires`, con el contenido de ese archivo.
// Devuelve { dir, path, text } o null. Una carpeta sin el archivo pedido no descarta a las demás:
// se sigue bajando por número hasta encontrar una que lo tenga.
export async function newestSpec(root, specDir, requires) {
  return (await everySpec(root, specDir, requires))[0] || null;
}
