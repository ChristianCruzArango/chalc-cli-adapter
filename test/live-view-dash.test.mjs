// T20 (spec 020, R17, R18, R20) — la vista del dashboard: indicadores, notas de los roles, specs y flujo SDD.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { viewOf } from '../catalog/live/lib/view.mjs';
import { buildState } from '../catalog/live/server.mjs';

const TASKS = '- [x] **T1** (R1) — Servicio\n- [ ] **T2** (R2) — HTTP\n';
const REVIEW = [
  '## 2026-10-13T10:05:00Z · abc1234 · revisor · FINDINGS: 1',
  '1. [spec] src/a.ts:3 — falta R2',
  '## 2026-10-13T10:09:00Z · abc1234 · revisor · OK',
  '- Hallazgo 1: corregido — src/a.ts:3 (ahora responde JSON)'
].join('\n');
const ACTIVITY = [
  { at: '2026-10-13T10:00:00.000Z', who: 'principal', kind: 'tool', task: 'T2' }
].map((a) => JSON.stringify(a)).join('\n');
const snapshot = {
  tasks: { done: 1, total: 2, current: '**T2** (R2) — HTTP', dir: 'specs/001-saludo' },
  gate: { exists: true, date: Date.parse('2026-10-13T10:04:00Z') }, review: { entries: [] },
  flow: { roles: [{ id: 'revisor', cadence: 'task', required: true }, { id: 'seguridad', cadence: 'task', required: true }] }, lang: 'es'
};
const SPECS = [{ dir: 'specs/001-saludo', spec: '# Spec: Saludo\n- **R1** — a\n- **R2** — b', plan: true, tasks: TASKS }];
const view = (over = {}) => viewOf({
  snapshot, decision: { action: 'work_task', facts: {} }, reason: '', state: { verdict: 'pass', date: 'd', stages: [] },
  tasksText: TASKS, activityText: ACTIVITY, usage: { tasks: { T1: { input: 5, output: 5, firstAt: '2026-10-13T09:00:00.000Z', lastAt: '2026-10-13T09:01:00.000Z' } } },
  reviewText: REVIEW, specFiles: SPECS, constitution: true, ...over
});

test('R17: the key indicators come in one place', () => {
  assert.deepEqual(view().kpis, { tasks: { done: 1, total: 2 }, verdict: 'pass', verdictText: 'APROBADO', tokens: 10, ms: 60_000, roles: { ok: 0, total: 2 } });
});

test('R18: the notes of the roles come whole, newest first, each with the task it was written in', () => {
  const notes = view().notes;
  assert.deepEqual(notes.map((n) => [n.role, n.ok, n.findings, n.task]), [['revisor', true, 0, 'T2'], ['revisor', false, 1, 'T2']]);
  assert.deepEqual(notes[0].lines, [{ text: 'Hallazgo 1: corregido — src/a.ts:3 (ahora responde JSON)', mark: 'fixed' }]);
  assert.deepEqual(view({ reviewText: undefined }).notes, []);
});

test('R20: the specs of the project, and which one the tasks come from', () => {
  const v = view();
  assert.deepEqual(v.specs.map((s) => [s.name, s.title, s.current, s.tasks]), [['001-saludo', 'Saludo', true, { done: 1, total: 2 }]]);
  assert.deepEqual(v.source, { dir: 'specs/001-saludo', title: 'Saludo' });
  assert.deepEqual(view({ specFiles: undefined }).specs, []);
});

test('R20: the SDD flow of the feature in progress', () => {
  assert.deepEqual(view().flow.map((p) => `${p.id}:${p.state}`), ['constitution:done', 'spec:done', 'plan:done', 'tasks:done', 'implement:current', 'gate:done', 'roles:current', 'close:pending']);
  assert.equal(view({ constitution: false }).flow[0].state, 'current');
});

test('R20: with no tasks yet, the newest spec is the one being written', () => {
  const v = view({ snapshot: { ...snapshot, tasks: { done: 0, total: 0 } }, tasksText: '', specFiles: [{ dir: 'specs/002-b', spec: '# B\n- **R1** — x', plan: false, tasks: null }, ...SPECS] });
  assert.deepEqual(v.source, { dir: 'specs/002-b', title: 'B' });
  assert.deepEqual(v.flow.slice(1, 3).map((p) => p.state), ['done', 'current']);
  const none = view({ snapshot: { ...snapshot, tasks: {} }, tasksText: '', specFiles: [] });
  assert.deepEqual([none.source, none.flow[1].state], [{ dir: '', title: '' }, 'current']);
});

test('R18, R20: the board reads the review log, every spec folder and the constitution from the repo', async () => {
  const root = await mkdtemp(join(tmpdir(), 'chalc-live-dash-'));
  await mkdir(join(root, 'specs', '001-saludo'), { recursive: true });
  await mkdir(join(root, 'specs', '002-otra'), { recursive: true });
  await mkdir(join(root, '.chalc'), { recursive: true });
  await writeFile(join(root, 'specs', 'constitution.md'), '# Constitución\n');
  await writeFile(join(root, 'specs', '001-saludo', 'spec.md'), '# Spec: Saludo\n- **R1** — a\n');
  await writeFile(join(root, 'specs', '001-saludo', 'plan.md'), '# Plan\n');
  await writeFile(join(root, 'specs', '001-saludo', 'tasks.md'), TASKS);
  await writeFile(join(root, 'specs', '002-otra', 'plan.md'), '# Plan suelto\n');
  await writeFile(join(root, '.chalc', 'review.md'), REVIEW);
  const v = await buildState(root);
  assert.deepEqual(v.specs.map((s) => [s.name, s.plan, s.tasks.total]), [['002-otra', true, 0], ['001-saludo', true, 2]]);
  assert.equal(v.flow[0].state, 'done');
  assert.equal(v.notes.length, 2);
  assert.equal(v.source.title, 'Saludo');
});

// Los casos de abajo salen de la pasada de mutación.

test('R17: the roles indicator counts the roles whose review is OK', () => {
  const s = { ...snapshot, review: { entries: [{ role: 'revisor', date: Date.parse('2026-10-13T10:05:00Z'), ok: true, commit: 'abc1234', items: [] }] } };
  assert.deepEqual(view({ snapshot: s }).kpis.roles, { ok: 1, total: 2 });
});

test('R20: a folder with only spec.md has no plan; plan is a yes/no, not the text; no constitution file reads as none', async () => {
  const root = await mkdtemp(join(tmpdir(), 'chalc-live-dash-'));
  await mkdir(join(root, 'specs', '001-a'), { recursive: true });
  await mkdir(join(root, 'specs', '003-c'), { recursive: true });
  await writeFile(join(root, 'specs', '001-a', 'spec.md'), '# A\n');
  await writeFile(join(root, 'specs', '003-c', 'plan.md'), '# P\n');
  const { readSpecFiles, hasConstitution } = await import('../catalog/live/lib/specfiles.mjs');
  assert.deepEqual(await readSpecFiles(root, 'specs'), [
    { dir: 'specs/003-c', spec: null, plan: true, tasks: null },
    { dir: 'specs/001-a', spec: '# A\n', plan: false, tasks: null }
  ]);
  assert.equal(hasConstitution(root, 'specs'), false);
  await mkdir(join(root, 'specs', 'constitution.md'));
  assert.equal(hasConstitution(root, 'specs'), true);
});

// T23 (R21) — la frase titular, armada con datos: en qué tarea va, cómo quedó el portón y qué sigue.
test('R21: the headline says the task in progress, the gate verdict with what fails, and the next step', () => {
  const state = { verdict: 'blocked', date: 'd', stages: [{ stage: 'tests', ok: true }, { stage: 'security', ok: false, findings: 1 }, { stage: 'duplication', ok: false }, { stage: 'mutation', ok: true, skipped: true, reason: 'fast' }] };
  assert.deepEqual(view({ state, decision: { action: 'fix_gate', facts: {} } }).headline, {
    task: 'T2', index: 2, total: 2, verdict: 'blocked', verdictText: 'BLOQUEADO', failing: ['seguridad', 'duplicación'], action: 'fix_gate', role: ''
  });
});

test('R21: with every task done there is no task in progress, and a passing gate fails nothing', () => {
  const tasksText = '- [x] **T1** — a\n- [x] **T2** — b\n';
  const h = view({ tasksText, snapshot: { ...snapshot, tasks: { done: 2, total: 2, current: '' } }, decision: { action: 'call_role', facts: { role: 'endurecedor' } } }).headline;
  assert.deepEqual([h.task, h.index, h.total, h.failing, h.action, h.role], ['', 0, 2, [], 'call_role', 'endurecedor']);
});
