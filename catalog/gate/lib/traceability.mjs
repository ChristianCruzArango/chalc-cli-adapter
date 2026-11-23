// traceability.mjs — cada test cambiado cita un requisito que EXISTE en la spec (R7).
// Responsabilidad ÚNICA: cruzar las citas `R#` de los tests con los requisitos declarados.
// Razón de cambio: cómo se identifican requisitos y archivos de test.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// Es la regla que sostiene el método: si un test no dice qué requisito cubre, nadie puede saber si
// la spec quedó implementada y "todo verde" deja de significar nada. Y citar un `R#` inventado es
// peor que no citar ninguno — parece trazado y no lo está.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { everySpec } from './spec.mjs';
import { isTestFile, isUserSource } from './sources.mjs';
import { currentTask } from './tdd.mjs';
import { RULES } from './rules.mjs';

// Requisito declarado en la spec: `- **R1** — WHEN … THE SYSTEM SHALL …`.
const DECLARED = /\*\*(R\d+)\*\*/g;

// Cualquier mención a un requisito.
const MENTION = /\bR\d+\b/g;

// Los requisitos que la spec DECLARA. Si no hay ninguno en negrita — una spec escrita a mano puede
// no usarlas — se toma cualquier mención: comprobar de menos es mejor que no comprobar nada.
export function requirementsOf(text) {
  const declared = new Set([...String(text).matchAll(DECLARED)].map((m) => m[1]));
  if (declared.size) return declared;
  return new Set([...String(text).matchAll(MENTION)].map((m) => m[0]));
}

const finding = (file, line, rule, data = {}) => ({ file, line, rule, data });

// Comprueba la trazabilidad de los tests cambiados. `files` son rutas relativas a `root`.
// Sin spec en el repo devuelve vacío: R7 es condicional, y sin requisitos no hay contra qué trazar.
export async function checkTraceability(files, { root, specDir = 'specs' } = {}) {
  const tests = files.filter(isTestFile);
  if (!tests.length) return [];

  const specs = await everySpec(root, specDir, 'spec.md');
  if (!specs.length) return [];
  const spec = specs[0];

  // Una cita vale si el requisito existe en ALGUNA spec del repo, no solo en la vigente. Un test
  // que cubre un requisito de una spec anterior lo cita con su R#, y exigirle que lo resuelva
  // contra la de hoy convierte documentación correcta en un hallazgo. Lo que la regla persigue —una
  // cita que no corresponde a nada— se sigue detectando: un R# inventado no está en ninguna.
  const requirements = new Set(specs.flatMap((s) => [...requirementsOf(s.text)]));

  const found = [];
  for (const file of tests) {
    let text;
    try { text = await readFile(join(root, file), 'utf8'); } catch { continue; }   // borrado en la tarea

    const cited = [...text.matchAll(MENTION)]
      .map((m) => ({ id: m[0], line: text.slice(0, m.index).split('\n').length }));

    if (!cited.length) {
      found.push(finding(file, 1, RULES.noRequirement, { spec: spec.path }));
      continue;
    }

    // Una cita inventada se reporta aunque el test cite también una válida: parece trazado y no lo está.
    for (const { id, line } of cited) {
      if (!requirements.has(id)) found.push(finding(file, line, RULES.unknownRequirement, { id, spec: spec.path }));
    }
  }
  return found;
}

// Los requisitos que cita el texto de una tarea, una vez cada uno. `PR1` o `R2x` no son requisitos.
const requirementIds = (text) => [...new Set(String(text).match(/(?<!\w)R\d+(?!\w)/g) || [])];

// Lo que citan los archivos de test de `files`; uno borrado en la tarea no cita nada.
async function citedByTests(root, files) {
  const cited = new Set();
  for (const file of files.filter(isTestFile)) {
    let text;
    try { text = await readFile(join(root, file), 'utf8'); } catch { continue; }
    requirementIds(text).forEach((id) => cited.add(id));
  }
  return cited;
}

/**
 * El otro sentido de la trazabilidad (spec 030, R10): los requisitos de la tarea en curso que ningún test
 * cambiado por ella cita. Solo si la tarea cambió código de producción: sin él no hay nada que deba estar probado.
 */
export async function untestedRequirements(files, { root, specDir = 'specs' } = {}) {
  if (!files.some((file) => isUserSource(file) && !isTestFile(file))) return [];
  const task = await currentTask(root, specDir);
  const wanted = task.key ? requirementIds(task.text) : [];
  if (!wanted.length) return [];
  const cited = await citedByTests(root, files);
  return wanted.filter((id) => !cited.has(id))
    .map((id) => finding(task.tasksFile, task.line, RULES.requirementUntested, { id, task: task.key }));
}
