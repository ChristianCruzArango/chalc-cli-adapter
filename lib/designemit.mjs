// lib/designemit.mjs — emisión del contrato de diseño y su evaluador en un repo equipado (spec 038, R1).
// Responsabilidad ÚNICA: decir QUÉ se emite del diseño. Razón de cambio: qué archivos lo componen. La mecánica
// de copiar vive en `emittree.mjs`.
//
// El contrato (`.chalc/design.contract.json`) es configuración del USUARIO: se crea si falta, no se sobrescribe
// al re-equipar y no entra en el manifiesto de integridad. Sus valores de partida salen del propio evaluador.

import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emitTree, launcherFor } from './emittree.mjs';
import { CONTRACT_REL, DEFAULT_CONTRACT } from '../catalog/design/lib/contract.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const DESIGN_DIR = join(ROOT, 'catalog', 'design');   // origen por defecto
export const DESIGN_REL = '.chalc/design.mjs';               // entrada, tal como la invocan los roles

/** Crea el contrato de diseño de `projectPath` si falta. Devuelve si lo creó. */
export async function emitDesignContract(projectPath) {
  const file = join(projectPath, ...CONTRACT_REL.split('/'));
  if (existsSync(file)) return false;
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(DEFAULT_CONTRACT, null, 2) + '\n', 'utf8');
  return true;
}

/** Emite el evaluador de diseño en `projectPath` y, si falta, su contrato. Devuelve { written }. */
export async function emitDesign(projectPath, { sourceDir = DESIGN_DIR } = {}) {
  const written = await emitTree(projectPath, {
    sourceDir,
    subdir: 'design',
    launcherRel: DESIGN_REL,
    launcher: launcherFor('design', 'design.mjs', 'Contrato de diseño: evalúa las medidas de una interfaz contra .chalc/design.contract.json.')
  });
  await emitDesignContract(projectPath);
  return { written };
}
