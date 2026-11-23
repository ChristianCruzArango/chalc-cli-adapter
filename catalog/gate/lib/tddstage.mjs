// tddstage.mjs — la etapa `tdd` del portón (spec 030, R5–R8). Responsabilidad ÚNICA: exigir, cuando la tarea
// cambió código de producción, que su rojo esté registrado y que los tests sellados sigan como estaban. Razón de
// cambio: qué se exige del Test-First al medir.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// Es estática y barata: corre también con `--fast`. Añadir tests después del rojo está bien; lo que no se puede
// es tocar los que se sellaron sin volver a pasar por el rojo.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { digestOf } from './integrity.mjs';
import { RULES } from './rules.mjs';
import { isTestFile, isUserSource } from './sources.mjs';
import { currentTask, lastRed, readReds } from './tdd.mjs';

const base = { stage: 'tdd', blocked: false, command: '', code: null, ms: 0 };
const notApplicable = { ...base, ok: true, skipped: true, reason: 'no-source', findings: [] };

// ¿El test sellado sigue igual? Uno que ya no existe tampoco.
async function intact(root, file, sealed) {
  try { return digestOf(await readFile(join(root, ...file.split('/')))) === sealed; } catch { return false; }
}

async function findingsOf(root, { key, tasksFile }, red) {
  if (!red) return [{ file: tasksFile, line: 1, rule: RULES.noRed, data: { task: key } }];
  if (red.kind === 'skip') return [{ file: tasksFile, line: 1, rule: RULES.redSkippedWithCode, data: { task: key, reason: red.reason } }];
  const found = [];
  for (const [file, sealed] of Object.entries(red.tests || {})) {
    if (!await intact(root, file, sealed)) found.push({ file, line: 1, rule: RULES.sealedTestChanged, data: {} });
  }
  return found;
}

/** La etapa `tdd` para los archivos `files` de la tarea. Sin código de producción o sin tarea en curso, no aplica. */
export async function tddStage(root, { files, specDir }) {
  const production = files.filter((file) => isUserSource(file) && !isTestFile(file));
  const task = production.length ? await currentTask(root, specDir) : null;
  if (!task?.key) return notApplicable;
  const findings = await findingsOf(root, task, lastRed(await readReds(root), task.key));
  return { ...base, ok: findings.length === 0, reason: '', findings };
}
