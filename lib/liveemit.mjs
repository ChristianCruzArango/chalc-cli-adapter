// lib/liveemit.mjs — emisión del tablero en vivo dentro de un repo equipado (spec 020, R1).
// Responsabilidad ÚNICA: decir QUÉ se emite del tablero. Razón de cambio: qué archivos lo componen. La
// mecánica de copiar vive en `emittree.mjs`, como para el advisor.
//
// Va DESPUÉS del portón y del advisor: el tablero importa de sus árboles (`.chalc/gate/lib`, `.chalc/next/lib`)
// para mostrar el mismo estado que el advisor ve. Todo lo emitido cuelga de `.chalc/` y solo importa builtins
// de node o rutas relativas: corre con `node .chalc/live.mjs` aunque chalc no esté instalado.

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emitTree, launcherFor } from './emittree.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const LIVE_DIR = join(ROOT, 'catalog', 'live');
export const LIVE_ENTRY_REL = '.chalc/live.mjs';

/** Emite el tablero en `projectPath`. Devuelve { written }. */
export async function emitLive(projectPath, { sourceDir = LIVE_DIR } = {}) {
  const written = await emitTree(projectPath, {
    sourceDir,
    subdir: 'live',
    launcherRel: LIVE_ENTRY_REL,
    launcher: launcherFor('live', 'live.mjs', 'Tablero en vivo: levanta una página local con el estado del proyecto e imprime su URL.')
  });
  return { written };
}
