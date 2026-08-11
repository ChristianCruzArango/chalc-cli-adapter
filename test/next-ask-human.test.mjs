// T4 (R11) — qué hace el advisor cuando NO puede saber en qué punto va.
//
// El portón y el advisor tienen deberes opuestos ante la duda, y confundirlos rompe el ciclo. Si el
// portón se equivoca aprobando, pasa código malo: por eso bloquea. Si el advisor se atasca, el
// asistente se queda sin siguiente paso y el ciclo entero se detiene — un secuenciador que no puede
// avanzar es peor que no tener secuenciador.
//
// Por eso `ask_human` es una GUARDA previa a la tabla, no una fila más: cuando los hechos no se
// pueden leer, la tabla de R9 no se puede aplicar en absoluto, y el advisor devuelve el control en
// vez de adivinar un estado que el asistente obedecería a ciegas.

import test from 'node:test';
import assert from 'node:assert/strict';
import { decide } from '../catalog/next/lib/decide.mjs';

const GATE = 4000;
// Los roles del ciclo, como los declara `catalog/agents/` (spec 009).
const ROLES = [{ id: 'revisor', order: 10, cadence: 'task', required: true }];

const BRANCH = 'feature/008-advisor';

const snapshot = (over = {}) => ({
  tasks: { hasTasksFile: true, done: 1, total: 3, current: 'T2 — implementar el lector', mtime: GATE - 1, ...over.tasks },
  gate: { exists: true, date: GATE, verdict: 'pass', fast: false, branch: BRANCH, pending: [], ...over.gate },
  review: { entries: [{ role: 'revisor', date: GATE + 500, ok: true, findings: 0 }], ...over.review },
  changed: { files: ['src/pago.ts'], newestMtime: 3000, ...over.changed },
  flow: { approvals: { task: true, feature: true }, review: { required: true }, roles: ROLES, ...over.flow },
  git: { isRepo: true, branch: BRANCH, ...over.git },
  problems: over.problems || []
});

const actionOf = (over) => decide(snapshot(over)).action;

// ── lo que no se puede leer ───────────────────────────────────────────────────────────────────

test('R11 — sin tasks.md no hay ciclo que secuenciar', () => {
  assert.equal(actionOf({ tasks: { hasTasksFile: false, done: 0, total: 0, current: '' } }), 'ask_human');
});

test('R11 — un tasks.md sin checkboxes no se interpreta como feature terminada', () => {
  // Confundirlo con `done` sería el peor fallo posible: daría por cerrada una feature sin empezar.
  assert.equal(actionOf({ tasks: { done: 0, total: 0, current: '' } }), 'ask_human');
});

// R11b: la ausencia de git NO devuelve el control. El portón la resuelve recorriendo el árbol de
// fuentes en vez de fallar, y un advisor más estricto que el portón sería inservible justo donde
// más se necesita: un repo recién equipado que todavía no hizo `git init`.
test('R11b — sin git el advisor sigue aconsejando: la comprobación de rama no aplica', () => {
  assert.equal(actionOf({ git: { isRepo: false, branch: '' } }), 'tick_task');
});

test('R11b — sin git, una evidencia con rama no se descarta por no poder compararla', () => {
  assert.equal(
    actionOf({ git: { isRepo: false, branch: '' }, gate: { branch: 'feature/vieja' } }),
    'tick_task'
  );
});

test('R11b — CON git, una evidencia de otra rama sí se descarta', () => {
  assert.equal(actionOf({ gate: { branch: 'otra' }, changed: { files: ['src/x.ts'], newestMtime: 1 } }), 'run_gate');
});

test('R11 — un problema de lectura reportado por el snapshot devuelve el control', () => {
  assert.equal(actionOf({ problems: ['no se pudo cargar .chalc/gate/lib/changed.mjs'] }), 'ask_human');
});

// ── la guarda va ANTES de la tabla ────────────────────────────────────────────────────────────

test('R11 — no poder leer el estado gana a cualquier fila de la tabla de R9', () => {
  assert.equal(
    actionOf({ tasks: { hasTasksFile: false, done: 0, total: 0, current: '' }, gate: { pending: ['test.command'] } }),
    'ask_human'
  );
  assert.equal(
    actionOf({ problems: ['evidencia ilegible'], changed: { newestMtime: GATE + 1 } }),
    'ask_human'
  );
});

// ── los hechos dicen QUÉ no se pudo leer ──────────────────────────────────────────────────────

test('R10 — ask_human enumera lo que no pudo leerse, para que el humano sepa qué arreglar', () => {
  const result = decide(snapshot({ tasks: { hasTasksFile: false, done: 0, total: 0, current: '' } }));
  assert.ok(Array.isArray(result.facts.problems), 'los problemas van en una lista');
  assert.ok(result.facts.problems.length, 'la lista no puede ir vacía');
});

test('R10 — los problemas del snapshot llegan tal cual a los hechos', () => {
  const result = decide(snapshot({ problems: ['no se pudo cargar changed.mjs'] }));
  assert.ok(result.facts.problems.includes('no se pudo cargar changed.mjs'));
});

// ── nunca revienta ────────────────────────────────────────────────────────────────────────────

test('R11 — un estado sano no dispara la guarda', () => {
  assert.equal(actionOf({}), 'tick_task');
});

test('R11 — un snapshot sin la lista de problemas se trata como sin problemas', () => {
  const state = snapshot();
  delete state.problems;
  assert.doesNotThrow(() => decide(state));
  assert.equal(decide(state).action, 'tick_task');
});
