// lib/teamemit.mjs — emisión del orquestador del equipo dentro de un repo equipado (spec 032, R1).
// Responsabilidad ÚNICA: decir QUÉ se emite del equipo. Razón de cambio: qué archivos lo componen. La mecánica
// de copiar vive en `emittree.mjs`.
//
// Va después del portón: `team.mjs` lee el idioma de `.chalc/gate.json`. No tiene dependencias ni configuración
// obligatoria: sus datos (`ledger.jsonl`, `status.json`) los crea él mismo al registrar el primer evento.

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emitTree, launcherFor } from './emittree.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const TEAM_DIR = join(ROOT, 'catalog', 'team');   // origen por defecto del orquestador
export const TEAM_REL = '.chalc/team.mjs';               // entrada, tal como la invocan el orquestador y los roles

/** Emite el orquestador en `projectPath`. Devuelve { written }. */
export async function emitTeam(projectPath, { sourceDir = TEAM_DIR } = {}) {
  const written = await emitTree(projectPath, {
    sourceDir,
    subdir: 'team',
    launcherRel: TEAM_REL,
    launcher: launcherFor('team', 'team.mjs', 'Orquestador del equipo: registra lo que hace cada rol y muestra en qué va cada spec.')
  });
  return { written };
}
