// designspec.mjs — el diseño como parte de la spec (spec 038, R6, R7). Responsabilidad ÚNICA: leer qué superficie
// declara el plan y exigir `design.md` cuando hay interfaz. Razón de cambio: qué se pide a una spec con interfaz.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: se regenera al equipar el repo.
//
// PURO. La composición de una pantalla se decide y se aprueba ANTES de programarla: una spec con interfaz y sin
// diseño deja esa decisión a quien escriba el código, que es justo cuando los botones salen pegados.

import { parseProbes } from './probes.mjs';
import { RULES } from './rules.mjs';

const SURFACES = new Set(['ui', 'api', 'cli']);
// La línea `Superficie: …` (`Surface:`), con o sin viñeta y negrita. Tiene que EMPEZAR por la etiqueta.
const LABEL = /^\s*(?:[-*]\s+)?\**\s*(?:superficie|surface)\s*:\s*\**\s*(.*)$/im;

/** Las superficies que declara el plan (`ui`, `api`, `cli`), sin repetir. Sin declararlas, ninguna. */
export function surfaceOf(plan) {
  const line = LABEL.exec(String(plan ?? ''));
  if (!line || line[1].includes('<')) return [];
  return [...new Set(line[1].toLowerCase().split(/[,\s]+/).filter((word) => SURFACES.has(word)))];
}

/** Lo que le falta al diseño de la spec `dir`: con superficie `ui`, su `design.md`. */
export function designProblems(dir, files) {
  if (!surfaceOf(files['plan.md']).includes('ui') || String(files['design.md'] ?? '').trim()) return [];
  return [{ file: `${dir}/design.md`, line: 1, rule: RULES.designMissing, data: {} }];
}

/**
 * Lo que les falta a las sondas de la spec `dir` (spec 041, R6): con superficie `api` o `cli`, su `probes.json`;
 * y si existe, que se pueda ejecutar. Una spec sin interfaz se comprueba levantada, contra lo que prometió.
 */
export function probesProblems(dir, files) {
  const at = { file: `${dir}/probes.json`, line: 1 };
  if (!String(files['probes.json'] ?? '').trim()) {
    return surfaceOf(files['plan.md']).some((surface) => surface !== 'ui') ? [{ ...at, rule: RULES.probesMissing, data: {} }] : [];
  }
  const { problem } = parseProbes(files['probes.json']);
  return problem ? [{ ...at, rule: RULES.probesInvalid, data: { problem } }] : [];
}
