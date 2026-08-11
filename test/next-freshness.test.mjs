// T2 (R13, R14) — cuándo una evidencia sirve para cerrar una tarea.
//
// Esta es la razón de existir de la spec 008. El agujero que 007 dejó abierto no es "el asistente no
// corre el portón", es "el asistente lo corre, sigue tocando código y marca la tarea igual". Aquí se
// fija qué invalida un verde: que sea de antes del último cambio (R13), que venga de una corrida
// `--fast` (R14) o que sea de otra rama.
//
// Un verde inválido NO es un fallo: es ausencia de medida. Por eso todos estos casos van a
// `run_gate` y no a `fix_gate` — el arreglo es volver a medir, no arreglar nada.

import test from 'node:test';
import assert from 'node:assert/strict';
import { decide } from '../catalog/next/lib/decide.mjs';

const TOUCHED = 3000;
const GATE = 4000;
const REVIEW = 4500;
const TICKED = 5000;

// Los roles del ciclo, como los declara `catalog/agents/` (spec 009).
const ROLES = [{ id: 'revisor', order: 10, cadence: 'task', required: true }];

const BRANCH = 'feature/008-advisor';

// Base con el verde SIN reclamar: si nada lo invalida, la acción es `tick_task`. Así cada test de
// abajo demuestra exactamente qué invalidó la evidencia, sin que otro estado tape el resultado.
const snapshot = (over = {}) => ({
  tasks: { hasTasksFile: true, done: 1, total: 3, current: 'T2 — implementar el lector', mtime: GATE - 1, ...over.tasks },
  gate: { exists: true, date: GATE, verdict: 'pass', fast: false, branch: BRANCH, pending: [], ...over.gate },
  review: { entries: [{ role: 'revisor', date: REVIEW, ok: true, findings: 0 }], ...over.review },
  changed: { files: ['src/pago.ts'], newestMtime: TOUCHED, ...over.changed },
  flow: { approvals: { task: true, feature: true }, review: { required: true }, roles: ROLES, ...over.flow },
  git: { isRepo: true, branch: BRANCH, ...over.git }
});

const actionOf = (over) => decide(snapshot(over)).action;

test('el verde sin reclamar, con la evidencia vigente, cierra la tarea', () => {
  assert.equal(actionOf({}), 'tick_task');
});

// ── R13: la evidencia caduca cuando el código sigue avanzando ─────────────────────────────────

test('R13 — un fuente tocado DESPUÉS de la evidencia la invalida, aunque apruebe', () => {
  assert.equal(actionOf({ changed: { newestMtime: GATE + 1 } }), 'run_gate');
});

test('R13 — un fuente tocado en el mismo instante que la evidencia no la invalida', () => {
  // El portón lee los archivos al arrancar: mismo milisegundo significa "entró en la corrida".
  assert.equal(actionOf({ changed: { newestMtime: GATE } }), 'tick_task');
});

test('R13 — sin evidencia y con trabajo hecho, hay que medir', () => {
  assert.equal(actionOf({ gate: { exists: false, date: 0 } }), 'run_gate');
});

test('R13 — sin evidencia y sin trabajo que medir, no se manda a correr el portón en vano', () => {
  assert.equal(actionOf({ gate: { exists: false, date: 0 }, changed: { files: [], newestMtime: 0 } }), 'work_task');
});

test('R9.3 — sin evidencia NO se pide arreglar el portón: no hay nada que arreglar todavía', () => {
  // Encontrado al arrancar el ciclo en un repo real recién equipado: árbol limpio y ninguna corrida
  // previa. `parseGateState` devuelve `verdict: 'unknown'` como defecto seguro —correcto, porque
  // "no sé" nunca debe valer como aprobado— pero `fix_gate` lo leía como "salió mal" y mandaba a
  // arreglar una corrida que jamás ocurrió, citando una fecha vacía. `fix_gate` exige evidencia.
  assert.equal(
    actionOf({ gate: { exists: false, date: 0, verdict: 'unknown' }, changed: { files: [], newestMtime: 0 } }),
    'work_task'
  );
});

test('R9.3 — con evidencia que no aprueba, sí se pide arreglarla', () => {
  assert.equal(actionOf({ gate: { verdict: 'fail' } }), 'fix_gate');
  assert.equal(actionOf({ gate: { verdict: 'blocked' } }), 'fix_gate');
});

// ── R14: una corrida rápida no cierra tarea ───────────────────────────────────────────────────

test('R14 — un verde de una corrida --fast no cierra la tarea: manda a medir de nuevo', () => {
  assert.equal(actionOf({ gate: { fast: true } }), 'run_gate');
});

test('R14 — el --fast invalida el verde aunque el código no se haya tocado después', () => {
  assert.equal(actionOf({ gate: { fast: true }, changed: { newestMtime: GATE - 500 } }), 'run_gate');
});

test('R14 — un --fast que además falla sigue mandando a medir, no a arreglar', () => {
  // Con la mutación omitida, "falla" es un veredicto parcial: primero se mide entero.
  assert.equal(actionOf({ gate: { fast: true, verdict: 'fail' } }), 'run_gate');
});

// ── la evidencia de otra rama no es la de esta ────────────────────────────────────────────────

test('R13 — una evidencia de otra rama no vale para la rama actual', () => {
  assert.equal(actionOf({ gate: { branch: 'feature/007-quality-gate' } }), 'run_gate');
});

test('R13 — la evidencia de la rama actual sí vale', () => {
  assert.equal(actionOf({ gate: { branch: BRANCH }, git: { isRepo: true, branch: BRANCH } }), 'tick_task');
});

// ── los hechos que R10 necesita para redactar el motivo ───────────────────────────────────────

test('R10 — run_gate aporta por qué caducó: fecha del cambio, fecha de la evidencia y el --fast', () => {
  const byAge = decide(snapshot({ changed: { newestMtime: GATE + 1 } }));
  assert.equal(byAge.facts.newestMtime, GATE + 1);
  assert.equal(byAge.facts.evidenceDate, GATE);

  const byFast = decide(snapshot({ gate: { fast: true } }));
  assert.equal(byFast.facts.fast, true);

  const byBranch = decide(snapshot({ gate: { branch: 'otra' } }));
  assert.equal(byBranch.facts.otherBranch, 'otra');
});

test('R10 — sin evidencia previa, los hechos lo dicen en vez de inventar una fecha', () => {
  const result = decide(snapshot({ gate: { exists: false, date: 0 } }));
  assert.equal(result.facts.evidenceDate, null);
});
