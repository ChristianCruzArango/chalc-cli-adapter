// specstate.mjs — lo que el equipo necesita saber de UNA carpeta de spec (spec 033). Responsabilidad ÚNICA: leer
// su plan y decir si el usuario la aprobó tal como está. Razón de cambio: qué se exige a una spec para trabajarla.
//
// Este archivo lo emite chalc dentro de `.chalc/team/lib/`. No edites aquí: se regenera al equipar el repo.
//
// No decide por su cuenta qué es «aprobada»: usa la huella y el sello del portón (spec 024). El portón mira la
// carpeta ACTIVA; el equipo trabaja varias a la vez, así que aquí se pregunta por la carpeta que se pida.

import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { OPTIONAL_FILES, SPEC_FILES } from '../../gate/lib/specset.mjs';
import { specFingerprint } from '../../gate/lib/specprint.mjs';
import { readSeal } from '../../gate/lib/specseal.mjs';
import { planScope } from './scope.mjs';

const textOrNull = async (path) => { try { return await readFile(path, 'utf8'); } catch { return null; } };

/** ¿Existe `dir` como carpeta dentro de `root`? */
export async function isSpecFolder(root, dir) {
  try { return (await stat(join(root, ...dir.split('/')))).isDirectory(); } catch { return false; }
}

/** ¿Selló el usuario EXACTAMENTE el contenido actual de `dir`? Cualquier edición posterior lo invalida. */
export async function specApproved(root, dir) {
  const files = {};
  for (const name of [...SPEC_FILES, ...OPTIONAL_FILES]) files[name] = await textOrNull(join(root, ...dir.split('/'), name));
  const seal = await readSeal(root, dir);
  return Boolean(seal) && seal.fingerprint === specFingerprint(files);
}

/** { spec, touches, dependsOn } de `dir`, leídos de su `plan.md`. */
export async function specScope(root, dir) {
  return { spec: dir, ...planScope(await textOrNull(join(root, ...dir.split('/'), 'plan.md'))) };
}
