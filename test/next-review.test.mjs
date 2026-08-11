// T3 (R16, R18) — la revisión y las puertas de aprobación en la decisión.
//
// El portón mide lo medible; el revisor juzga lo que no se mide. Para que ese segundo par de ojos
// no sea opcional en la práctica, el advisor tiene que saber si la revisión que hay MIRÓ el código
// que hay: una revisión anterior a la evidencia vigente examinó otra cosa (R16).
//
// La aprobación del usuario, en cambio, NO es un estado: es una frase, no un artefacto, y un estado
// del que no se puede salir es un deadlock (R18, y Artículo 6 de la constitución). Vive como un
// hecho de `tick_task`, que es lo que sí se puede comprobar.

import test from 'node:test';
import assert from 'node:assert/strict';
import { decide } from '../catalog/next/lib/decide.mjs';

const GATE = 4000;
const REVIEW = 4500;

// Los roles del ciclo, como los declara `catalog/agents/` (spec 009).
const ROLES = [{ id: 'revisor', order: 10, cadence: 'task', required: true }];

const BRANCH = 'feature/008-advisor';

// Base con el verde SIN reclamar y la revisión al día: la acción natural es `tick_task`.
const snapshot = (over = {}) => ({
  tasks: { hasTasksFile: true, done: 1, total: 3, current: 'T2 — implementar el lector', mtime: GATE - 1, ...over.tasks },
  gate: { exists: true, date: GATE, verdict: 'pass', fast: false, branch: BRANCH, pending: [], ...over.gate },
  review: { entries: [{ role: 'revisor', date: REVIEW, ok: true, findings: 0 }], ...over.review },
  changed: { files: ['src/pago.ts'], newestMtime: 3000, ...over.changed },
  flow: { approvals: { task: true, feature: true }, review: { required: true }, roles: ROLES, ...over.flow },
  git: { isRepo: true, branch: BRANCH, ...over.git }
});

const actionOf = (over) => decide(snapshot(over)).action;

// ── R16: la revisión vale si miró ESTE código ─────────────────────────────────────────────────

test('R16 — sin revisión, el verde no cierra: primero pasa el revisor', () => {
  assert.equal(actionOf({ review: { entries: [] } }), 'call_role');
});

test('R16 — una revisión ANTERIOR a la evidencia miró otro código', () => {
  assert.equal(actionOf({ review: { entries: [{ role: 'revisor', date: GATE - 1, ok: true, findings: 0 }] } }), 'call_role');
});

test('R16 — una revisión del mismo instante que la evidencia SÍ cuenta', () => {
  // Este test pedía antes `>` estricto. Recorrer el ciclo en un repo real lo desmintió: la bitácora
  // fecha en segundos y la evidencia en milisegundos, así que el empate al segundo es el caso
  // NORMAL —el revisor corre inmediatamente después del portón— y no una coincidencia rara. Con `>`
  // estricto el ciclo se quedaba pidiendo revisor indefinidamente.
  assert.equal(actionOf({ review: { entries: [{ role: 'revisor', date: GATE, ok: true, findings: 0 }] } }), 'tick_task');
});

test('R16 — una revisión posterior y limpia cierra la tarea', () => {
  assert.equal(actionOf({ review: { entries: [{ role: 'revisor', date: GATE + 1, ok: true, findings: 0 }] } }), 'tick_task');
});

test('R16 — una revisión del mismo SEGUNDO que la evidencia cuenta como posterior', () => {
  // Encontrado recorriendo el ciclo en un repo real. El contrato de `.chalc/review.md` fija la fecha
  // con precisión de SEGUNDO, y la evidencia lleva milisegundos: una revisión hecha justo después
  // del portón aparecía como anterior hasta por 999 ms, y el advisor pedía revisor otra vez para
  // siempre. Se compara con la granularidad del dato menos preciso, que es la única honesta.
  const evidenceAt = Date.parse('2026-08-09T19:56:30.472Z');
  const reviewedAt = Date.parse('2026-08-09T19:56:30Z');

  assert.equal(actionOf({ gate: { date: evidenceAt }, review: { entries: [{ role: 'revisor', date: reviewedAt, ok: true, findings: 0 }] }, tasks: { mtime: 0 } }), 'tick_task');
});

test('R16 — una revisión del segundo ANTERIOR sigue siendo vieja', () => {
  const evidenceAt = Date.parse('2026-08-09T19:56:30.472Z');
  const reviewedAt = Date.parse('2026-08-09T19:56:29Z');

  assert.equal(actionOf({ gate: { date: evidenceAt }, review: { entries: [{ role: 'revisor', date: reviewedAt, ok: true, findings: 0 }] }, tasks: { mtime: 0 } }), 'call_role');
});

test('R16 — una revisión posterior con hallazgos manda a arreglarlos', () => {
  assert.equal(actionOf({ review: { entries: [{ role: 'revisor', date: REVIEW, ok: false, findings: 2 }] } }), 'fix_review');
});

test('R10 — fix_review aporta cuántos hallazgos hay', () => {
  assert.equal(decide(snapshot({ review: { entries: [{ role: 'revisor', date: REVIEW, ok: false, findings: 2 }] } })).facts.findings, 2);
});

test('R10 — call_reviewer aporta la fecha de la evidencia que hay que revisar', () => {
  const result = decide(snapshot({ review: { entries: [] } }));
  assert.equal(result.facts.evidenceDate, GATE);
  assert.equal(result.facts.reviewDate, null);
});

// ── flow.review.required: el repo sin agente revisor no puede quedarse clavado ─────────────────

// Desde la spec 009, "no requerido" se declara POR ROL: `flow.roles[].required`. El knob global de
// la 008 sobrevive solo como defecto cuando el repo no declara roles, y eso lo resuelve `snapshot`.
const withoutRoles = { approvals: { task: true, feature: true }, review: { required: true }, roles: [{ ...ROLES[0], required: false }] };

test('R18 — con el rol no requerido, su ausencia no bloquea el cierre', () => {
  assert.equal(actionOf({ review: { entries: [] }, flow: withoutRoles }), 'tick_task');
});

test('R18 — con el rol no requerido, unos hallazgos suyos tampoco bloquean', () => {
  assert.equal(
    actionOf({ review: { entries: [{ role: 'revisor', date: REVIEW, ok: false, findings: 5 }] }, flow: withoutRoles }),
    'tick_task'
  );
});

// ── R18: la aprobación es un hecho de tick_task, nunca un estado ──────────────────────────────

test('R18 — con la puerta activada, tick_task pide esperar el OK', () => {
  assert.equal(decide(snapshot({})).facts.waitForApproval, true);
});

test('R18 — con la puerta desactivada, tick_task NO pide esperar', () => {
  const flow = { approvals: { task: false, feature: true }, review: { required: true } };
  assert.equal(decide(snapshot({ flow })).facts.waitForApproval, false);
});

test('R18 — la puerta no cambia la acción, solo lo que se pide al marcar', () => {
  const flow = { approvals: { task: false, feature: true }, review: { required: true } };
  assert.equal(actionOf({ flow }), 'tick_task');
  assert.equal(actionOf({}), 'tick_task');
});

test('R18 — ningún estado se llama await_approval: no tendría salida observable', () => {
  const states = [
    {}, { gate: { pending: ['x'] } }, { changed: { newestMtime: GATE + 1 } }, { gate: { verdict: 'fail' } },
    { review: { entries: [] } }, { review: { entries: [{ role: 'revisor', date: REVIEW, ok: false, findings: 1 }] } },
    { tasks: { mtime: GATE + 1 } }, { tasks: { done: 3, total: 3, current: '' } }
  ].map((over) => decide(snapshot(over)).action);

  assert.ok(!states.includes('await_approval'), `no debe existir await_approval, salieron: ${states.join(', ')}`);
});
