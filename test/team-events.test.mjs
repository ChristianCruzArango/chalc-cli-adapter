// Spec 032 (estado de equipo), T1 — el vocabulario de eventos del orquestador (R3). Un evento desconocido o al
// que le faltan datos no se registra: el estado y el informe salen SOLO de esto.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EVENTS, eventProblem } from '../catalog/team/lib/events.mjs';

const ok = (event) => assert.equal(eventProblem(event), '', JSON.stringify(event));
const bad = (event, reason) => assert.equal(eventProblem(event), reason, JSON.stringify(event));

test('R3: cada tipo declara sus campos obligatorios', () => {
  assert.deepEqual(EVENTS.started, ['spec', 'worktree', 'branch', 'launcher', 'tier']);
  assert.deepEqual(EVENTS.blocked, ['spec', 'reason']);
  assert.deepEqual(EVENTS.feature_opened, ['feature', 'agent']);
  for (const type of ['spec_added', 'spec_approved', 'scheduled', 'signal', 'gate', 'delivered', 'reviewed', 'rework', 'escalated', 'unblocked', 'integrated', 'lead', 'needs_human', 'human_done', 'closed']) {
    assert.ok(Array.isArray(EVENTS[type]), type);
  }
});

test('R3: un evento bien formado no tiene problema', () => {
  ok({ type: 'feature_opened', feature: 'pagos', agent: 'claude' });
  ok({ type: 'spec_added', feature: 'pagos', spec: 'specs/027-checkout' });
  ok({ type: 'gate', spec: 'specs/027-checkout', verdict: 'fail', stage: 'mutation', score: 71 });
  ok({ type: 'reviewed', spec: 'specs/027-checkout', role: 'revisor', ok: false, findings: 2, summary: 'R2 sin probar' });
  ok({ type: 'signal', spec: 'specs/027-checkout' });
  ok({ type: 'scheduled', spec: 'specs/027-checkout', wave: 0 });
});

test('R3: tipo desconocido, campo que falta o vacío, y lo que no es un objeto, se rechazan diciendo qué', () => {
  bad({ type: 'inventado', spec: 'x' }, 'unknown-type');
  bad({ spec: 'x' }, 'unknown-type');
  bad({ type: 'blocked', spec: 'specs/027-checkout' }, 'missing:reason');
  bad({ type: 'blocked', spec: 'specs/027-checkout', reason: '   ' }, 'missing:reason');
  bad({ type: 'started', spec: 's', worktree: 'w', branch: 'b', launcher: 'codex' }, 'missing:tier');
  bad({ type: 'reviewed', spec: 's', role: 'revisor', findings: 0, summary: '' }, 'missing:ok');
  bad(null, 'unknown-type');
  bad('texto', 'unknown-type');
});

test('R3: false y 0 son datos, no ausencias', () => {
  ok({ type: 'reviewed', spec: 's', role: 'revisor', ok: false, findings: 0, summary: 'nada' });
});
