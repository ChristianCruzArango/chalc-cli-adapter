// lib/evalsemit.mjs — emisión de los evals activos en un repo equipado (spec 042, R1).
// Responsabilidad ÚNICA: decir QUÉ se emite de los evals. Razón de cambio: qué archivos los componen. La mecánica
// de copiar vive en `emittree.mjs`.

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emitTree, launcherFor } from './emittree.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const EVALS_DIR = join(ROOT, 'catalog', 'evals');   // origen por defecto
export const EVALS_REL = '.chalc/evals.mjs';               // entrada

/** Emite los evals en `projectPath`. Devuelve { written }. */
export async function emitEvals(projectPath, { sourceDir = EVALS_DIR } = {}) {
  const written = await emitTree(projectPath, {
    sourceDir,
    subdir: 'evals',
    launcherRel: EVALS_REL,
    launcher: launcherFor('evals', 'evals.mjs', 'Evals activos: casos con trampa que se puntúan sin juez, para comparar roles, instrucciones o modelos.')
  });
  return { written };
}
