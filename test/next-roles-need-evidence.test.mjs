// Un rol de revisión entra sobre una evidencia, nunca antes de ella.
//
// Encontrado en la prueba de punta a punta de la spec 014: al empezar una tarea —sin código escrito y
// sin portón corrido— el advisor respondía «El portón aprobó a las — y falta que pase el agente…». La
// fila `call_role` solo miraba que no hubiera entrada del rol, y sin evidencia nunca la hay. El
// resultado era mandar a revisar una tarea que no había empezado. Venía de la spec 009.

import test from 'node:test';
import assert from 'node:assert/strict';
import { decide } from '../catalog/next/lib/decide.mjs';

const ROLES = [
  { id: 'seguridad', order: 5, cadence: 'task', required: true },
  { id: 'revisor', order: 10, cadence: 'task', required: true },
  { id: 'endurecedor', order: 20, cadence: 'feature', required: true }
];
const NO_EVIDENCE = { exists: false, date: 0, verdict: 'unknown', fast: true, branch: '', pending: [] };

const snapshot = ({ tasks = {}, gate = NO_EVIDENCE } = {}) => ({
  tasks: { hasTasksFile: true, done: 0, total: 2, current: 'T1 — cobrar', mtime: 5, ...tasks },
  gate,
  review: { entries: [] },
  changed: { files: [], newestMtime: 0 },
  flow: { approvals: { task: true, feature: true }, roles: ROLES },
  git: { isRepo: true, branch: 'main' },
  problems: []
});

test('with no evidence and nothing written yet, the next step is to work on the task', () => {
  assert.equal(decide(snapshot()).action, 'work_task');
});

// Lo mismo al cerrar la feature: el endurecedor audita una evidencia, no un repo sin medir.
test('with every task ticked but no evidence, no feature role is called', () => {
  const result = decide(snapshot({ tasks: { done: 2, total: 2, current: '' } }));
  assert.notEqual(result.action, 'call_role');
});

test('with a passing evidence, the first role is called as before', () => {
  const gate = { exists: true, date: 4000, verdict: 'pass', fast: false, branch: 'main', pending: [], scopeHash: 'h', currentScopeHash: 'h' };
  const result = decide({ ...snapshot({ gate }), changed: { files: ['src/a.js'], newestMtime: 3000 } });
  assert.deepEqual([result.action, result.facts.role], ['call_role', 'seguridad']);
});
