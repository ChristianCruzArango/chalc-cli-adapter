// Spec 032 (estado de equipo), T2 — el estado se deriva SOLO del registro (R4–R7): por feature su líder y sus
// specs, y por spec en qué va, con qué intento, qué dijo el portón y si parece atascada.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reduce } from '../catalog/team/lib/reduce.mjs';

const T = (minutes) => new Date(Date.parse('2026-11-22T10:00:00.000Z') + minutes * 60000).toISOString();
const S = 'specs/027-checkout';
const base = [
  { at: T(0), type: 'feature_opened', feature: 'pagos', agent: 'claude' },
  { at: T(1), type: 'spec_added', feature: 'pagos', spec: S }
];
const state = (events, opts = {}) => reduce(events, { now: Date.parse(T(60)), stallMs: 20 * 60000, maxAttempts: 3, ...opts });
const specOf = (events, opts) => state(events, opts).features[0].specs[0];

test('R4: sin eventos, el estado está vacío', () => {
  assert.deepEqual(state([]), { updated: T(60), waitingHuman: [], features: [] });
});

test('R5: una feature recién abierta con su spec en borrador', () => {
  assert.deepEqual(state(base), {
    updated: T(60), waitingHuman: [],
    features: [{
      feature: 'pagos', closed: false, lead: { agent: 'claude', action: '', since: T(0) },
      specs: [{ spec: S, state: 'draft', wave: null, worktree: '', branch: '', developer: { launcher: '', tier: '' }, phase: '', task: '', attempt: 0, maxAttempts: 3, relaunched: false, lastGate: null, lastFinding: '', blockedBy: '', lastSignal: T(1), stalled: false }]
    }]
  });
});

test('R5: el recorrido normal de una spec, evento a evento', () => {
  const steps = [
    [{ at: T(2), type: 'spec_approved', spec: S }, 'approved'],
    [{ at: T(3), type: 'scheduled', spec: S, wave: 1 }, 'scheduled'],
    [{ at: T(4), type: 'started', spec: S, worktree: '../wt/027', branch: 'chalc/027-checkout', launcher: 'codex', tier: 'medio' }, 'in_dev'],
    [{ at: T(9), type: 'delivered', spec: S, head: 'abc1234' }, 'delivered'],
    [{ at: T(10), type: 'reviewed', spec: S, role: 'revisor', ok: true, findings: 0, summary: 'OK' }, 'reviewed_ok'],
    [{ at: T(11), type: 'integrated', spec: S, head: 'def5678' }, 'integrated']
  ];
  const events = [...base];
  for (const [event, expected] of steps) {
    events.push(event);
    assert.equal(specOf(events).state, expected, event.type);
  }
  const done = specOf(events);
  assert.deepEqual([done.wave, done.worktree, done.branch, done.developer, done.attempt], [1, '../wt/027', 'chalc/027-checkout', { launcher: 'codex', tier: 'medio' }, 1]);
});

test('R5: la fase, la tarea y el último portón salen de las señales', () => {
  const s = specOf([...base,
    { at: T(4), type: 'started', spec: S, worktree: 'w', branch: 'b', launcher: 'codex', tier: 'medio' },
    { at: T(5), type: 'signal', spec: S, phase: 'RED', task: '1 de 7' },
    { at: T(6), type: 'signal', spec: S, phase: 'GREEN' },
    { at: T(7), type: 'gate', spec: S, verdict: 'fail', stage: 'mutation', score: 71, fast: false }]);
  assert.deepEqual([s.phase, s.task, s.lastSignal], ['GREEN', '1 de 7', T(7)]);
  assert.deepEqual(s.lastGate, { verdict: 'fail', stage: 'mutation', score: 71, fast: false, at: T(7) });
});

test('R5: un rechazo cuenta el intento, guarda el hallazgo y vuelve a desarrollo con el rework', () => {
  const events = [...base,
    { at: T(4), type: 'started', spec: S, worktree: 'w', branch: 'b', launcher: 'codex', tier: 'medio' },
    { at: T(9), type: 'delivered', spec: S, head: 'a' },
    { at: T(10), type: 'reviewed', spec: S, role: 'revisor', ok: false, findings: 2, summary: 'el test de R2 no comprueba el total' }];
  const rejected = specOf(events);
  assert.deepEqual([rejected.state, rejected.attempt, rejected.lastFinding], ['rejected', 1, 'revisor: el test de R2 no comprueba el total']);
  events.push({ at: T(11), type: 'rework', spec: S });
  assert.deepEqual([specOf(events).state, specOf(events).attempt], ['in_dev', 2]);
});

test('R5: un OK de un rol no borra el rechazo de otro en la misma entrega; una entrega nueva sí empieza limpia', () => {
  const events = [...base,
    { at: T(4), type: 'started', spec: S, worktree: 'w', branch: 'b', launcher: 'codex', tier: 'medio' },
    { at: T(9), type: 'delivered', spec: S, head: 'a' },
    { at: T(10), type: 'reviewed', spec: S, role: 'seguridad', ok: false, findings: 1, summary: 'A03 sin validar' },
    { at: T(11), type: 'reviewed', spec: S, role: 'revisor', ok: true, findings: 0, summary: 'OK' }];
  assert.equal(specOf(events).state, 'rejected');
  events.push({ at: T(12), type: 'rework', spec: S }, { at: T(20), type: 'delivered', spec: S, head: 'b' }, { at: T(21), type: 'reviewed', spec: S, role: 'seguridad', ok: true, findings: 0, summary: 'OK' });
  assert.equal(specOf(events).state, 'reviewed_ok');
});

test('R5: bloqueo y escalado se ven con su motivo; desbloquear vuelve al estado anterior', () => {
  const started = [...base, { at: T(4), type: 'started', spec: S, worktree: 'w', branch: 'b', launcher: 'codex', tier: 'medio' }];
  const blocked = specOf([...started, { at: T(5), type: 'blocked', spec: S, reason: 'falta la clave del API de pagos' }]);
  assert.deepEqual([blocked.state, blocked.blockedBy], ['blocked', 'falta la clave del API de pagos']);
  const back = specOf([...started, { at: T(5), type: 'blocked', spec: S, reason: 'x y z' }, { at: T(6), type: 'unblocked', spec: S }]);
  assert.deepEqual([back.state, back.blockedBy], ['in_dev', '']);
  const escalated = specOf([...started, { at: T(5), type: 'escalated', spec: S, reason: 'tres rechazos' }]);
  assert.deepEqual([escalated.state, escalated.blockedBy], ['escalated', 'tres rechazos']);
});

test('R6: lo que espera al usuario se lista aparte, y se quita cuando lo atiende', () => {
  const waiting = { at: T(5), type: 'needs_human', feature: 'pagos', reason: 'aprobar cierre', command: 'node .chalc/gate.mjs --approve-feature' };
  assert.deepEqual(state([...base, waiting]).waitingHuman, [{ feature: 'pagos', reason: 'aprobar cierre', command: 'node .chalc/gate.mjs --approve-feature', since: T(5) }]);
  assert.deepEqual(state([...base, waiting, { at: T(6), type: 'human_done', feature: 'pagos' }]).waitingHuman, []);
});

test('R5: la acción del líder y el cierre de la feature', () => {
  const f = state([...base, { at: T(5), type: 'lead', feature: 'pagos', action: 'integrando' }, { at: T(9), type: 'closed', feature: 'pagos' }]).features[0];
  assert.deepEqual([f.lead, f.closed], [{ agent: 'claude', action: 'integrando', since: T(5) }, true]);
});

test('R7: una spec en desarrollo sin señal más allá del umbral es un posible atasco, sin cambiar de estado', () => {
  const started = [...base, { at: T(4), type: 'started', spec: S, worktree: 'w', branch: 'b', launcher: 'codex', tier: 'medio' }];
  const stuck = specOf(started);
  assert.deepEqual([stuck.state, stuck.stalled], ['in_dev', true]);
  assert.equal(specOf([...started, { at: T(50), type: 'signal', spec: S }]).stalled, false);
  assert.equal(specOf(started, { now: Date.parse(T(24)) }).stalled, false, 'justo en el umbral todavía no');
  assert.equal(specOf(started, { now: Date.parse(T(24)) + 1 }).stalled, true);
});

test('R7: solo se atasca quien está trabajando: en borrador, entregada, integrada o bloqueada no', () => {
  assert.equal(specOf(base).stalled, false);
  const started = [...base, { at: T(4), type: 'started', spec: S, worktree: 'w', branch: 'b', launcher: 'codex', tier: 'medio' }];
  assert.equal(specOf([...started, { at: T(9), type: 'delivered', spec: S, head: 'a' }]).stalled, false);
  assert.equal(specOf([...started, { at: T(5), type: 'blocked', spec: S, reason: 'x y z' }]).stalled, false);
});

test('R4: varias features y specs, en el orden en que se abrieron; un evento de una spec desconocida se ignora', () => {
  const events = [...base,
    { at: T(2), type: 'spec_added', feature: 'pagos', spec: 'specs/028-recibos' },
    { at: T(3), type: 'feature_opened', feature: 'envios', agent: 'codex' },
    { at: T(4), type: 'spec_added', feature: 'envios', spec: 'specs/029-rutas' },
    { at: T(5), type: 'gate', spec: 'specs/999-fantasma', verdict: 'pass' }];
  const out = state(events);
  assert.deepEqual(out.features.map((f) => [f.feature, f.specs.map((s) => s.spec)]), [['pagos', [S, 'specs/028-recibos']], ['envios', ['specs/029-rutas']]]);
});
