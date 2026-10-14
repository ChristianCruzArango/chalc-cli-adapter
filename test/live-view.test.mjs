// T3 (spec 020, R5, R7) — el modelo del tablero: en qué paso va, qué corrió y qué falta.
//
// Reusa lo que ya calcula el advisor (snapshot + decide + reasonOf): el tablero no lee el repo por su
// cuenta, así que no puede contradecirlo. Aquí solo se ordena para que se lea de un vistazo.

import test from 'node:test';
import assert from 'node:assert/strict';
import { allReviews } from '../catalog/next/lib/review.mjs';
import { viewOf } from '../catalog/live/lib/view.mjs';
import { taskList } from '../catalog/next/lib/tasks.mjs';
import { renderState } from '../catalog/gate/lib/evidence.mjs';
import { frameOf } from '../catalog/gate/lib/i18n.mjs';

const GATE = Date.parse('2026-10-13T15:00:00Z');
const TASKS = ['- [x] **T1** (R1, R2) — Servicio', '- [ ] **T2** (R1) — Exponer por HTTP', '- [ ] **T3** — Mutación'].join('\n');
const ROLES = [
  { id: 'seguridad', order: 5, cadence: 'task', required: true, checklist: 'owasp' },
  { id: 'revisor', order: 10, cadence: 'task', required: true, checklist: 'requirements' },
  { id: 'endurecedor', order: 20, cadence: 'feature', required: true }
];
const LOG = [
  '## 2026-10-13T14:00:00Z · a1b2c3d4e5 · revisor · OK',
  '## 2026-10-13T15:05:00Z · a1b2c3d4e5 · seguridad · OK',
  '## 2026-10-13T15:06:00Z · a1b2c3d4e5 · revisor · FINDINGS: 1',
  '- R1: no cumple — src/app.module.ts:7',
  '1. [spec] src/app.module.ts:7 — el módulo no se importa'
].join('\n');
const STATE = {
  date: '2026-10-13T15:00:00.000Z', verdict: 'pass', fast: false,
  stages: [
    { stage: 'tests', ok: true, blocked: false, skipped: false, reason: '' },
    { stage: 'build', ok: true, blocked: false, skipped: false, reason: '' },
    { stage: 'mutation', ok: true, blocked: false, skipped: false, reason: '', score: 92.31, survivors: 1 },
    { stage: 'security', ok: true, blocked: false, skipped: true, reason: 'disabled' }
  ]
};
const snapshot = {
  tasks: { hasTasksFile: true, done: 1, total: 3, current: '**T2** (R1) — Exponer por HTTP' },
  gate: { exists: true, date: GATE, verdict: 'pass', spec: 'specs/001-saludo' },
  review: { entries: allReviews(LOG) },
  flow: { roles: ROLES },
  lang: 'es'
};
const view = (over = {}) => viewOf({
  snapshot, decision: { action: 'fix_review', facts: { role: 'revisor' } }, reason: 'El agente `revisor` dejó 1 hallazgo(s)…',
  state: STATE, tasksText: TASKS, activityText: '', ...over
});

test('R5: the list of tasks says which are done, which is in progress and what they require', () => {
  assert.deepEqual(taskList(TASKS), [
    { done: true, text: '**T1** (R1, R2) — Servicio' },
    { done: false, text: '**T2** (R1) — Exponer por HTTP' },
    { done: false, text: '**T3** — Mutación' }
  ]);
  assert.deepEqual(view().tasks.map(({ id, text, done, current, requirements }) => ({ id, text, done, current, requirements })), [
    { id: 'T1', text: 'T1 (R1, R2) — Servicio', done: true, current: false, requirements: ['R1', 'R2'] },
    { id: 'T2', text: 'T2 (R1) — Exponer por HTTP', done: false, current: true, requirements: ['R1'] },
    { id: 'T3', text: 'T3 — Mutación', done: false, current: false, requirements: [] }
  ]);
});

test('R5: the feature, its progress and the language come along', () => {
  const v = view();
  assert.deepEqual({ feature: v.feature, progress: v.progress, lang: v.lang }, { feature: 'specs/001-saludo', progress: { done: 1, total: 3 }, lang: 'es' });
});

test('R5: the next action is the advisor\'s, with its reason', () => {
  assert.deepEqual(view().next, { action: 'fix_review', role: 'revisor', reason: 'El agente `revisor` dejó 1 hallazgo(s)…' });
});

test('R5: the last gate shows each stage with its result, and the mutation score', () => {
  const { gate } = view();
  assert.equal(gate.verdict, 'pass');
  assert.equal(gate.date, '2026-10-13T15:00:00.000Z');
  assert.deepEqual(gate.stages, [
    { stage: 'tests', title: 'tests', result: 'passed', status: 'pasó', reason: '', findings: 0, details: [] },
    { stage: 'build', title: 'compilación', result: 'passed', status: 'pasó', reason: '', findings: 0, details: [] },
    { stage: 'mutation', title: 'mutación', result: 'passed', status: 'pasó', reason: '', findings: 0, details: [], score: 92.31, survivors: 1 },
    { stage: 'security', title: 'seguridad', result: 'skipped', status: frameOf('es').status.skippedDisabled, reason: 'disabled', findings: 0, details: [] }
  ]);
  assert.deepEqual(view({ state: null }).gate, { verdict: 'none', verdictText: '', date: '', stages: [] });
  assert.equal(view({ state: { ...STATE, stages: [{ stage: 'tests', ok: false, blocked: true }] } }).gate.stages[0].result, 'blocked');
  assert.equal(view({ state: { ...STATE, stages: [{ stage: 'tests', ok: false }] } }).gate.stages[0].result, 'failed');
});

test('R5: each role says whether its review covers the current evidence, and what it left', () => {
  const [seguridad, revisor, endurecedor] = view().roles;
  assert.deepEqual(seguridad, { id: 'seguridad', cadence: 'task', status: 'ok', date: '2026-10-13T15:05:00.000Z', findings: [], requirements: {}, followups: {} });
  assert.equal(revisor.status, 'findings');
  assert.deepEqual(revisor.findings, [{ n: 1, text: '[spec] src/app.module.ts:7 — el módulo no se importa' }]);
  assert.deepEqual(revisor.requirements, { R1: { status: 'violates', refs: ['src/app.module.ts:7'] } });
  assert.deepEqual(endurecedor, { id: 'endurecedor', cadence: 'feature', status: 'none', date: '', findings: [], requirements: {}, followups: {} });
});

test('R5: a review older than the evidence is stale', () => {
  const log = '## 2026-10-13T14:00:00Z · a1b2c3d4e5 · seguridad · OK';
  assert.equal(view({ snapshot: { ...snapshot, review: { entries: allReviews(log) } } }).roles[0].status, 'stale');
});

test('R5: «what is missing» lists the pending tasks, the roles still to pass and the next action', () => {
  assert.deepEqual(view().missing, {
    tasks: ['T2 (R1) — Exponer por HTTP', 'T3 — Mutación'],
    roles: ['revisor', 'endurecedor'],
    next: 'fix_review'
  });
});

test('R6: the activity comes newest first, and broken lines are skipped', () => {
  const lines = [
    JSON.stringify({ at: '2026-10-13T15:06:00.000Z', who: 'principal', kind: 'tool', tool: 'Read', summary: 'a.ts' }),
    '{ roto',
    JSON.stringify({ at: '2026-10-13T15:07:00.000Z', who: 'revisor', kind: 'start' })
  ].join('\n');
  assert.deepEqual(view({ activityText: lines }).activity.map((a) => [a.who, a.kind]), [['revisor', 'start'], ['principal', 'tool']]);
});

test('R5: with nothing yet (no tasks, no gate, no reviews) the view is still well formed', () => {
  const empty = viewOf({ snapshot: { tasks: {}, gate: {}, review: {}, flow: {}, lang: 'en' }, decision: { action: 'work_task', facts: {} }, reason: '', state: null, tasksText: '', activityText: '' });
  assert.deepEqual(empty.tasks, []);
  assert.deepEqual(empty.roles, []);
  assert.deepEqual(empty.missing, { tasks: [], roles: [], next: 'work_task' });
  assert.equal(empty.lang, 'en');
});

// El estado del portón trae ahora el score y los supervivientes de la mutación: el tablero los muestra sin
// tener que leer la prosa de gate.md.
test('R5: the gate state carries the mutation score and survivor count', () => {
  const state = renderState({
    stages: [{ stage: 'mutation', ok: true, score: 92.31, survivors: [{ file: 'a', line: 1 }] }, { stage: 'tests', ok: true }],
    meta: { date: new Date('2026-10-13T15:00:00Z') }, fast: false
  });
  assert.equal(state.stages[0].score, 92.31);
  assert.equal(state.stages[0].survivors, 1);
  assert.equal('score' in state.stages[1], false);
});

// Los casos de abajo salen de la pasada de mutación.

test('R5: task boxes are read with any bullet, indentation, case and spacing, and only at the start of a line', () => {
  const md = ['  * [X] **T1** — uno   ', '-[ ]T2 — dos', '- [x]   T3 — tres', 'texto - [ ] no es tarea', '- [ ]'].join('\n');
  assert.deepEqual(taskList(md), [{ done: true, text: '**T1** — uno' }, { done: false, text: 'T2 — dos' }, { done: true, text: 'T3 — tres' }]);
  assert.deepEqual(taskList(undefined), []);
});

test('R5: a review in the same second as the evidence covers it; a role not required is not shown', () => {
  const s = {
    ...snapshot,
    gate: { ...snapshot.gate, date: Date.parse('2026-10-13T15:05:00.900Z') },
    flow: { roles: [...ROLES, { id: 'opcional', cadence: 'task', required: false }] }
  };
  const v = view({ snapshot: s });
  assert.equal(v.roles.find((r) => r.id === 'seguridad').status, 'ok');
  assert.ok(!v.roles.some((r) => r.id === 'opcional'));
});

test('R5: the follow-ups of a role entry come along', () => {
  const log = '## 2026-10-13T15:06:00Z · a1b2c3d4e5 · revisor · OK\n- Hallazgo 1: corregido — a.ts:1';
  const revisor = view({ snapshot: { ...snapshot, review: { entries: allReviews(log) } } }).roles.find((r) => r.id === 'revisor');
  assert.deepEqual(revisor.followups, { 1: { status: 'fixed', refs: ['a.ts:1'] } });
});

test('R5: a snapshot missing whole sections, and a decision without facts, still give a view', () => {
  const v = viewOf({ snapshot: {}, decision: { action: 'ask_human' }, reason: 'r', state: null, tasksText: TASKS, activityText: '' });
  assert.deepEqual({ feature: v.feature, progress: v.progress, roles: v.roles, next: v.next, lang: v.lang }, {
    feature: '', progress: { done: 0, total: 0 }, roles: [], next: { action: 'ask_human', role: '', reason: 'r' }, lang: 'en'
  });
  assert.equal(v.tasks.filter((t) => t.current).length, 0);
});

test('R5: without a gate run every role review counts as current', () => {
  const s = { ...snapshot, gate: { exists: false }, review: { entries: allReviews('## 2026-10-13T10:00:00Z · a1b2c3d4e5 · seguridad · OK') } };
  assert.equal(view({ snapshot: s }).roles[0].status, 'ok');
});

test('R5: a stage without score has none, and a score without survivors counts zero', () => {
  const v = view({ state: { ...STATE, stages: [{ stage: 'mutation', ok: true, score: 100 }, { stage: 'tests', ok: true }] } });
  assert.deepEqual(v.gate.stages.map(({ title, status, ...rest }) => rest), [{ stage: 'mutation', result: 'passed', reason: '', findings: 0, details: [], score: 100, survivors: 0 }, { stage: 'tests', result: 'passed', reason: '', findings: 0, details: [] }]);
  assert.equal(view({ state: { verdict: 'pass', date: 'd' } }).gate.stages.length, 0);
});

// El tablero no vuelve a buscar tasks.md: el snapshot del advisor expone el que ya leyó (spec 020).
test('R5: the advisor snapshot exposes the tasks.md it read and the spec folder', async () => {
  const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { snapshot: read } = await import('../catalog/next/lib/snapshot.mjs');
  const root = await mkdtemp(join(tmpdir(), 'chalc-live-snap-'));
  await mkdir(join(root, 'specs', '001-saludo'), { recursive: true });
  await writeFile(join(root, 'specs', '001-saludo', 'tasks.md'), TASKS);
  const s = await read(root, { changed: async () => ({ files: [] }), branch: async () => 'b', head: async () => 'a1b2c3d4e5' });
  assert.equal(s.tasks.dir, 'specs/001-saludo');
  assert.equal(s.tasks.text, TASKS);
  assert.equal(viewOf({ snapshot: s, decision: { action: 'work_task', facts: {} }, reason: '', state: null, tasksText: s.tasks.text, activityText: '' }).feature, 'specs/001-saludo');
});
