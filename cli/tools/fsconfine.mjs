// cli/tools/fsconfine.mjs — confinamiento de las herramientas de archivo a la raíz del proyecto:
// resolver rutas sin escapar (traversal, otra unidad, symlinks/junctions hacia fuera), no tocar
// `.git/` y escribir sobre el destino real revalidado justo antes de abrir.

import { mkdir, open } from 'node:fs/promises';
import { realpathSync, lstatSync, constants as FS } from 'node:fs';
import { resolve, relative, isAbsolute, join, dirname, basename } from 'node:path';

const isSymlink = (p) => { try { return lstatSync(p).isSymbolicLink(); } catch { return false; } };

// realpath del ancestro EXISTENTE más profundo: al escribir, el archivo destino puede no existir aún,
// pero sus carpetas padre sí — y son ellas las que podrían ser un symlink/junction hacia fuera.
// Un enlace COLGANTE (o en bucle) también hace fallar a realpath, pero no es "no existe": su destino
// puede estar fuera del proyecto, así que se devuelve null y quien llama lo rechaza.
export function deepestExistingRealpath(p) {
  let cur = p;
  for (;;) {
    try { return realpathSync(cur); } catch { /* no existe, o es un enlace sin destino */ }
    if (isSymlink(cur)) return null;
    const parent = dirname(cur);
    if (parent === cur) return cur;   // llegó a la raíz del filesystem sin existir: se devuelve tal cual
    cur = parent;
  }
}

export const escapes = (base, target) => {
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
  const real = deepestExistingRealpath(abs);
  if (real === null || escapes(deepestExistingRealpath(resolve(root)), real)) {
    throw new Error(`path outside the project (symlink): ${p}`);
  }
  return abs;
}

// La ruta REAL de `abs` relativa a la raíz real, con '/': lo que de verdad se va a escribir aunque se
// pida por un enlace interno (`notes -> .claude`). Para un archivo que aún no existe se resuelve su
// ancestro existente más profundo y se le añade el resto. Llamar tras resolveInRoot (ya confinada).
export function realRelative(root, abs) {
  const realRoot = realpathSync(resolve(root));
  const rest = [];
  for (let cur = abs; ; cur = dirname(cur)) {
    try { return relative(realRoot, join(realpathSync(cur), ...rest)).replace(/\\/g, '/'); } catch { /* aún no existe: se sube */ }
    rest.unshift(basename(cur));
  }
}

// La ruta tal cual y su ruta real relativa a la raíz, para clasificar por las dos (V-04: un enlace
// `notes.txt -> .env` es un `.env`). Si la real no se puede resolver, solo la pedida.
export function pathAndReal(root, p) {
  try { return [p, realRelative(root, resolve(root, p))]; } catch { return [p]; }
}

// `.git/` no es código del proyecto: un `.git/hooks/pre-commit` o un `.git/config` con
// `core.fsmonitor` se ejecutan solos en el siguiente commit o `git status`. Se mira la ruta pedida y
// la real (un enlace interno hacia `.git` cuenta igual); sin distinguir mayúsculas, como macOS y Windows.
export const GIT_DIR = /(^|[\\/])\.git([\\/]|$)/i;
export function assertNotGitDir(base, p, target) {
  const rel = relative(base, target);
  if (GIT_DIR.test(String(p)) || GIT_DIR.test(rel)) throw new Error(`writing inside .git/ is not allowed: ${p}`);
}

// O_NOFOLLOW no existe en Windows; allí la revalidación de la ruta es la única defensa.
const NOFOLLOW = FS.O_NOFOLLOW ?? 0;

// Escribe en el destino REAL, revalidado justo antes de abrir. La ruta se resolvió antes de pedir
// aprobación, y en la espera alguien pudo cambiar el archivo por un enlace hacia fuera: se vuelve a
// confinar, se escribe sobre el realpath y se abre con O_NOFOLLOW, de modo que un enlace puesto en el
// último instante hace fallar la escritura (ELOOP) en vez de seguirse.
export async function writeConfined(root, p, content, { append = false } = {}) {
  const abs = resolveInRoot(root, p);
  await mkdir(dirname(abs), { recursive: true });
  const target = isSymlink(abs) ? realpathSync(abs) : join(realpathSync(dirname(abs)), basename(abs));
  if (escapes(realpathSync(resolve(root)), target)) throw new Error(`path outside the project (symlink): ${p}`);
  assertNotGitDir(realpathSync(resolve(root)), p, target);
  const flags = FS.O_WRONLY | FS.O_CREAT | (append ? FS.O_APPEND : FS.O_TRUNC) | NOFOLLOW;
  const handle = await open(target, flags, 0o666);
  try { await handle.writeFile(content); } finally { await handle.close(); }
  return target;
}
