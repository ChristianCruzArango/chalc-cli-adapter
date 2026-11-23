// uicheck.mjs — las specs con interfaz en el equipo (spec 040, R3–R5). Responsabilidad ÚNICA: decir si una spec
// tiene interfaz y si su interfaz se midió, limpia, sobre el código que se entrega. Razón de cambio: qué se
// exige a una entrega con interfaz.
//
// Este archivo lo emite chalc dentro de `.chalc/team/lib/`. No edites aquí: se regenera al equipar el repo.
//
// La medición existe (`node .chalc/design.mjs measure`), pero una comprobación que hay que acordarse de correr
// no protege nada: aquí pasa a ser condición de la entrega. Vale la misma regla que con el portón: un commit de
// código posterior deja la medición vieja.

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { surfaceOf } from '../../gate/lib/designspec.mjs';
import { onlyEvidenceSince } from './evidence.mjs';

const OUT = ['.chalc', 'design-out'];

/** ¿Declara el plan de `spec` una interfaz (`Superficie: ui`)? */
export async function isUi(dir, spec) {
  try { return surfaceOf(await readFile(join(dir, ...spec.split('/'), 'plan.md'), 'utf8')).includes('ui'); } catch { return false; }
}

/** ¿Hay en `dir` una medición sin hallazgos del código que tiene ahora? */
export async function uiMeasured(dir, spec) {
  let saved = null;
  try { saved = JSON.parse(await readFile(join(dir, ...OUT, 'measurements.json'), 'utf8')); } catch { return false; }
  return saved?.findings === 0 && onlyEvidenceSince(dir, spec, saved.commit);
}

/** La ruta de la galería de `dir`, o '' si no se ha medido. */
export function galleryOf(dir) {
  const file = join(dir, ...OUT, 'gallery.html');
  return existsSync(file) ? file : '';
}

// Las superficies sin interfaz que declara el plan de `spec`: `api`, `cli`.
async function headless(dir, spec) {
  try { return surfaceOf(await readFile(join(dir, ...spec.split('/'), 'plan.md'), 'utf8')).filter((surface) => surface !== 'ui'); } catch { return []; }
}

/** ¿Necesita `spec` sondas (superficie `api` o `cli`) y NO hay un resultado sin fallos de este código? (spec 041, R7) */
export async function missingProbes(dir, spec) {
  if (!(await headless(dir, spec)).length) return false;
  let saved = null;
  try { saved = JSON.parse(await readFile(join(dir, '.chalc', 'probe-out', 'results.json'), 'utf8')); } catch { return true; }
  return !(saved?.failures === 0 && saved.spec === spec && onlyEvidenceSince(dir, spec, saved.commit));
}
