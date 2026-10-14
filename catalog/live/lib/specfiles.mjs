// specfiles.mjs — las carpetas de `specs/` tal como están en disco (spec 020, R20). Responsabilidad ÚNICA:
// leer de cada carpeta de spec su `spec.md`, si tiene `plan.md` y su `tasks.md`. Razón de cambio: dónde y
// cómo se guardan las specs. Lo que significan lo dice `sdd.mjs`.
//
// Este archivo lo emite chalc dentro de `.chalc/live/lib/`. No edites aquí: se regenera al equipar.
//
// Usa `everySpec` del portón —el mismo que decide cuál es la spec vigente—, así que el tablero ve las mismas
// carpetas, en el mismo orden (la de número más alto primero).

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { everySpec } from '../../gate/lib/spec.mjs';

const FILES = { spec: 'spec.md', plan: 'plan.md', tasks: 'tasks.md' };
const number = (dir) => Number(dir.split('/').pop().match(/^\d+/)[0]);

/** Cada carpeta de spec con al menos uno de sus archivos: `{ dir, spec, plan, tasks }`, la más reciente primero. */
export async function readSpecFiles(root, specDir) {
  const byDir = new Map();
  for (const [key, file] of Object.entries(FILES)) {
    for (const found of await everySpec(root, specDir, file)) {
      const entry = byDir.get(found.dir) || { dir: found.dir, spec: null, plan: false, tasks: null };
      entry[key] = key === 'plan' ? true : found.text;
      byDir.set(found.dir, entry);
    }
  }
  return [...byDir.values()].sort((a, b) => number(b.dir) - number(a.dir));
}

/** ¿Tiene el proyecto su constitución (`<specs>/constitution.md`)? */
export const hasConstitution = (root, specDir) => existsSync(join(root, specDir, 'constitution.md'));
