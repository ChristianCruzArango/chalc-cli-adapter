// lib/githooks.mjs — los hooks de git de un repo equipado (spec 029, R1–R3). Responsabilidad ÚNICA: dejarlos en
// `.chalc/hooks/` y activarlos con `core.hooksPath`. Razón de cambio: cómo se instala un hook de git.
//
// Los hooks de un asistente solo existen en ese asistente. Estos corren con cualquiera, y también cuando
// commitea una persona: son la base del cumplimiento, no un refuerzo. Qué HACE cada hook lo decide el portón
// (`catalog/gate/lib/hook.mjs`); aquí solo se instalan.
//
// Nunca se pisa lo del proyecto: si `core.hooksPath` ya apunta a otra carpeta (husky, lefthook…), se deja y
// se dice qué línea añadir a los hooks que ya existen.

import { spawnSync } from 'node:child_process';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { filesOf } from './emittree.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const GITHOOKS_DIR = join(ROOT, 'catalog', 'githooks');   // origen de los hooks
export const HOOKS_PATH = '.chalc/hooks';                         // valor de `core.hooksPath`, relativo a la raíz

// `windowsHide`: sin consola nueva en Windows. Nunca pasa por una shell.
const git = (args, cwd) => spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
// Dónde está el proyecto respecto de git: fuera de un repo, en su raíz o en una subcarpeta. Se le pregunta a git
// el prefijo (vacío en la raíz) en vez de comparar rutas: en Windows git devuelve la ruta larga con `/` y el
// temporal del sistema llega en formato corto (`RUNNER~1`), así que la misma carpeta no comparaba igual.
function placeOf(projectPath) {
  const prefix = git(['rev-parse', '--show-prefix'], projectPath);
  if (prefix.status !== 0) return 'no-git';
  return prefix.stdout.trim() === '' ? 'root' : 'not-root';
}

// Copia los hooks con fin de línea de Unix (los corre `sh`) y ejecutables donde eso existe.
async function copyHooks(projectPath) {
  const written = [];
  for (const name of (await filesOf(GITHOOKS_DIR)).sort()) {
    const dest = join(projectPath, ...HOOKS_PATH.split('/'), name);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, (await readFile(join(GITHOOKS_DIR, name), 'utf8')).replace(/\r\n/g, '\n'), 'utf8');
    if (process.platform !== 'win32') await chmod(dest, 0o755);
    written.push(`${HOOKS_PATH}/${name}`);
  }
  return written;
}

// Fija `core.hooksPath` salvo que el proyecto ya tenga el suyo. Devuelve { status, other }.
function activate(projectPath) {
  const current = git(['config', '--local', '--get', 'core.hooksPath'], projectPath).stdout.trim();
  if (current === HOOKS_PATH) return { status: 'unchanged', other: '' };
  if (current) return { status: 'kept-other', other: current };
  git(['config', '--local', 'core.hooksPath', HOOKS_PATH], projectPath);
  return { status: 'installed', other: '' };
}

/**
 * Deja los hooks en `projectPath` y los activa si puede. Devuelve { written, status, other }, con `status`
 * `installed`, `unchanged`, `kept-other` (el proyecto ya usa `other`), `no-git` o `not-root`.
 */
export async function emitGitHooks(projectPath) {
  const written = await copyHooks(projectPath);
  const place = placeOf(projectPath);
  return { written, ...(place === 'root' ? activate(projectPath) : { status: place, other: '' }) };
}
