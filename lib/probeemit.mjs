// lib/probeemit.mjs — emisión de las sondas de API y CLI en un repo equipado (spec 041, R1).
// Responsabilidad ÚNICA: decir QUÉ se emite de las sondas. Razón de cambio: qué archivos las componen. La mecánica
// de copiar vive en `emittree.mjs`.

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emitTree, launcherFor } from './emittree.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const PROBE_DIR = join(ROOT, 'catalog', 'probe');   // origen por defecto
export const PROBE_REL = '.chalc/probe.mjs';               // entrada, tal como la invocan los roles

/** Emite las sondas en `projectPath`. Devuelve { written }. */
export async function emitProbe(projectPath, { sourceDir = PROBE_DIR } = {}) {
  const written = await emitTree(projectPath, {
    sourceDir,
    subdir: 'probe',
    launcherRel: PROBE_REL,
    launcher: launcherFor('probe', 'probe.mjs', 'Sondas de API y CLI: ejecuta las de probes.json de una spec contra el servicio levantado.')
  });
  return { written };
}
