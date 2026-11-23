// lib/tooldrift.mjs — las herramientas de `.chalc/` frente a las del catálogo de chalc (spec 029, R9).
// Responsabilidad ÚNICA: decir qué archivos de herramientas de un proyecto no son los que chalc emite. Razón
// de cambio: qué árboles del catálogo se emiten.
//
// El manifiesto de integridad vive en el repo que protege; el catálogo está fuera. Esta comparación es la que
// no se puede torcer desde dentro del proyecto. También sale distinta cuando el proyecto se equipó con una
// versión anterior: en los dos casos la respuesta es re-equipar.

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { digestOf } from '../catalog/gate/lib/integrity.mjs';
import { filesOf } from './emittree.mjs';
import { GATE_DIR } from './gateemit.mjs';
import { GITHOOKS_DIR } from './githooks.mjs';
import { LIVE_DIR } from './liveemit.mjs';
import { MAIL_DIR } from './mailemit.mjs';
import { MEMORY_DIR } from './memoryemit.mjs';
import { NEXT_DIR } from './nextemit.mjs';
import { TEAM_DIR } from './teamemit.mjs';
import { DESIGN_DIR } from './designemit.mjs';
import { PROBE_DIR } from './probeemit.mjs';
import { EVALS_DIR } from './evalsemit.mjs';

// Cada árbol del catálogo y la subcarpeta de `.chalc/` donde se emite.
const TREES = [[GATE_DIR, 'gate'], [NEXT_DIR, 'next'], [MAIL_DIR, 'mail'], [MEMORY_DIR, 'memory'], [LIVE_DIR, 'live'], [TEAM_DIR, 'team'], [DESIGN_DIR, 'design'], [PROBE_DIR, 'probe'], [EVALS_DIR, 'evals'], [GITHOOKS_DIR, 'hooks']];

/** ¿Tiene `projectDir` herramientas de chalc emitidas? */
export const hasTooling = (projectDir) => existsSync(join(projectDir, '.chalc', 'gate', 'gate.mjs'));

// ¿El archivo emitido es el del catálogo? Uno que falta no lo es.
async function sameAsCatalog(source, emitted) {
  let actual;
  try { actual = await readFile(emitted); } catch { return false; }
  return digestOf(actual) === digestOf(await readFile(source));
}

/** Rutas (relativas al proyecto, con '/') de las herramientas que faltan o difieren de las del catálogo. */
export async function toolingDrift(projectDir) {
  const drift = [];
  for (const [sourceDir, subdir] of TREES) {
    for (const rel of await filesOf(sourceDir)) {
      const same = await sameAsCatalog(join(sourceDir, ...rel.split('/')), join(projectDir, '.chalc', subdir, ...rel.split('/')));
      if (!same) drift.push(`.chalc/${subdir}/${rel}`);
    }
  }
  return drift.sort();
}
