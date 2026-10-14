// T19b (spec 020, R20) — el flujo SDD completo y de qué spec salen las tareas.
//
// El tablero muestra la feature como el método la recorre: constitución → spec → plan → tareas → implementación
// (TDD + mutación) → portón → roles → cierre, cada fase con su estado. Y la lista de specs del proyecto, para
// saber de cuál salen las tareas que se están haciendo.

import test from 'node:test';
import assert from 'node:assert/strict';
import { phasesOf, specsOf } from '../catalog/live/lib/sdd.mjs';

const SPEC = '# Spec: 001-saludo\n\n- **R1** — WHEN …\n- **R2** — WHEN …\n- **R2** — repetido\nCita a R7 sin definirlo.';
const FILES = [
  { dir: 'specs/002-despedida', spec: '# Despedida\n- **R1** — x', plan: false, tasks: null },
  { dir: 'specs/001-saludo', spec: SPEC, plan: true, tasks: '- [x] **T1** — a\n- [ ] **T2** — b\n' }
];

test('R20: each spec folder says its title, how many requirements it defines, if it has a plan and its progress', () => {
  assert.deepEqual(specsOf(FILES, 'specs/001-saludo'), [
    { dir: 'specs/002-despedida', name: '002-despedida', title: 'Despedida', requirements: 1, plan: false, tasks: { done: 0, total: 0 }, current: false },
    { dir: 'specs/001-saludo', name: '001-saludo', title: '001-saludo', requirements: 2, plan: true, tasks: { done: 1, total: 2 }, current: true }
  ]);
});

test('R20: a spec without a title or without spec.md still shows, by its folder name', () => {
  const [entry] = specsOf([{ dir: 'specs/003-x', spec: null, plan: false, tasks: null }], '');
  assert.deepEqual([entry.title, entry.requirements, entry.current], ['003-x', 0, false]);
  assert.equal(specsOf([{ dir: 'specs/004-y', spec: 'sin título\n- **R1** — z', plan: true, tasks: '' }], '')[0].title, '004-y');
  assert.deepEqual(specsOf(undefined, ''), []);
});

const base = {
  constitution: true,
  spec: { requirements: 2, plan: true, tasks: { done: 1, total: 3 } },
  gate: { verdict: 'pass', verdictText: 'APROBADO' },
  roles: [{ status: 'ok' }, { status: 'none' }],
  action: 'work_task'
};
const states = (input) => phasesOf(input).map((p) => `${p.id}:${p.state}`);

test('R20: the eight phases in order, done up to where the feature is, then the one in progress', () => {
  assert.deepEqual(states(base), ['constitution:done', 'spec:done', 'plan:done', 'tasks:done', 'implement:current', 'gate:done', 'roles:current', 'close:pending']);
});

test('R20: each phase carries its detail', () => {
  const byId = Object.fromEntries(phasesOf(base).map((p) => [p.id, p.detail]));
  assert.deepEqual(byId, { constitution: '', spec: { n: 2 }, plan: '', tasks: { n: 3 }, implement: { done: 1, total: 3 }, gate: { text: 'APROBADO' }, roles: { done: 1, total: 2 }, close: '' });
});

test('R20: a gate that does not pass and a role with findings are problems, not progress', () => {
  const s = states({ ...base, gate: { verdict: 'blocked', verdictText: 'BLOQUEADO' }, roles: [{ status: 'findings' }, { status: 'ok' }] });
  assert.deepEqual(s.slice(5, 7), ['gate:failed', 'roles:failed']);
  assert.equal(states({ ...base, gate: { verdict: 'fail', verdictText: 'NO PASA' } })[5], 'gate:failed');
});

test('R20: nothing written yet: the first missing phase is the one in progress, the rest pending', () => {
  const empty = { constitution: true, spec: null, gate: { verdict: 'none', verdictText: '' }, roles: [], action: 'ask_human' };
  assert.deepEqual(states(empty), ['constitution:done', 'spec:current', 'plan:pending', 'tasks:pending', 'implement:pending', 'gate:pending', 'roles:pending', 'close:pending']);
  assert.equal(states({ ...empty, constitution: false })[0], 'constitution:current');
});

test('R20: with a spec but no plan or tasks yet, the plan is in progress', () => {
  assert.deepEqual(states({ ...base, spec: { requirements: 1, plan: false, tasks: { done: 0, total: 0 } }, gate: { verdict: 'none' }, roles: [] }).slice(1, 5),
    ['spec:done', 'plan:current', 'tasks:pending', 'implement:pending']);
});

test('R20: all tasks done, roles OK and the advisor says done: every phase is done', () => {
  const finished = { ...base, spec: { requirements: 2, plan: true, tasks: { done: 3, total: 3 } }, roles: [{ status: 'ok' }], action: 'done' };
  assert.ok(states(finished).every((s) => s.endsWith(':done')), states(finished).join());
});

test('R20: a stale review is not done; without roles the phase has nothing to wait for', () => {
  assert.equal(states({ ...base, roles: [{ status: 'stale' }] })[6], 'roles:current');
  assert.equal(states({ ...base, roles: [] })[6], 'roles:done');
});

// Los casos de abajo salen de la pasada de mutación.

test('R20: the title is the first heading, trimmed, with or without «Spec:»; requirement numbers can be long', () => {
  const spec = 'intro # no es título\n#  Spec:   Saludo largo   \n- **R10** — a\n- **R11** — b\n- **R1** — c';
  const [entry] = specsOf([{ dir: 'specs/005-z', spec, plan: true, tasks: '' }], '');
  assert.deepEqual([entry.title, entry.requirements], ['Saludo largo', 3]);
  assert.equal(specsOf([{ dir: 'specs/006-w', spec: '#\tSpec:Pegado', plan: true, tasks: '' }], '')[0].title, 'Pegado');
});

test('R20: with nothing to show, a phase has no detail; roles count only those that are OK', () => {
  const empty = Object.fromEntries(phasesOf({ constitution: true, spec: null, gate: { verdict: 'none', verdictText: '' }, roles: [], action: '' }).map((p) => [p.id, p.detail]));
  assert.deepEqual(empty, { constitution: '', spec: '', plan: '', tasks: '', implement: '', gate: '', roles: '', close: '' });
  const roles = phasesOf({ ...base, roles: [{ status: 'ok' }, { status: 'findings' }, { status: 'ok' }] }).find((p) => p.id === 'roles');
  assert.deepEqual(roles.detail, { done: 2, total: 3 });
  assert.equal(phasesOf({ ...base, spec: { requirements: 1, plan: true } }).find((p) => p.id === 'tasks').detail, '');
});

test('R20: a plan with an empty task list leaves the tasks phase in progress; a gate not run yet is pending', () => {
  assert.equal(states({ ...base, spec: { requirements: 1, plan: true, tasks: { done: 0, total: 0 } } })[3], 'tasks:current');
  assert.equal(states({ ...base, spec: { requirements: 1, plan: true } })[3], 'tasks:current');
  assert.equal(states({ ...base, gate: { verdict: 'none' } })[5], 'gate:pending');
  assert.equal(states({ ...base, gate: {} })[5], 'gate:pending');
});
