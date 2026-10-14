// T18 (spec 020, R16) — una revisión de la tarea cerrada no se le exige a la siguiente.
//
// Encontrado en el segundo E2E del tablero: el revisor dio OK a T1 respondiendo su R1; se marcó T1, la tarea en
// curso pasó a ser T2 (R1, R2) y, como el código no cambió, la revisión de T1 seguía vigente y se validó contra
// los requisitos de T2: «R2: not reviewed», `ask_human`. Una revisión escrita ANTES de la última marca de
// `tasks.md` es de la tarea ya cerrada —se validó para dejar cerrarla—. En la duda, el mismo segundo, se valida.

import test from 'node:test';
import assert from 'node:assert/strict';
import { allReviews } from '../catalog/next/lib/review.mjs';
import { decide } from '../catalog/next/lib/decide.mjs';

const GATE = Date.parse('2026-10-13T23:10:00Z');
const REVIEW = '## 2026-10-13T23:10:30Z · dc7e13bd88 · revisor · OK\n- R1: cumple — src/saludo.controller.ts:5';
const snap = (tasksMtime, current = '**T2** (R1, R2) — HTTP') => ({
  tasks: { hasTasksFile: true, done: 1, total: 3, current, mtime: tasksMtime },
  gate: { exists: true, date: GATE, verdict: 'pass', fast: false, scopeHash: 'h', currentScopeHash: 'h', scopeFiles: ['src/saludo.controller.ts'], branch: 'b', pending: [] },
  review: { entries: allReviews(REVIEW) },
  changed: { files: ['src/saludo.controller.ts'], touched: ['src/saludo.controller.ts'], newestMtime: GATE - 10 },
  flow: { approvals: { task: true, feature: true }, roles: [{ id: 'revisor', order: 10, cadence: 'task', required: true, checklist: 'requirements' }] },
  git: { isRepo: true, branch: 'b' },
  platform: { mobile: false },
  problems: []
});

test('R16: after ticking the task, the review of the closed task does not block the next one', () => {
  assert.equal(decide(snap(Date.parse('2026-10-13T23:11:00Z'))).action, 'work_task');
});

test('R16: a review written after the last tick is still checked against the task in progress', () => {
  const result = decide(snap(Date.parse('2026-10-13T23:09:00Z')));
  assert.equal(result.action, 'ask_human');
  assert.ok(result.facts.problems.some((p) => /R2: not reviewed/.test(p)), JSON.stringify(result.facts));
});

test('R16: review and tick in the same second: in doubt, it is checked', () => {
  assert.equal(decide(snap(Date.parse('2026-10-13T23:10:30.800Z'))).action, 'ask_human');
});

test('R16: without a known tasks.md date every review is checked, as before', () => {
  assert.equal(decide(snap(undefined)).action, 'ask_human');
});
