// T14 (spec 020, R10, R11, R12, R13) — la vista con el detalle a un clic, los tokens y el tiempo.
//
// Cada tarea trae lo que la página despliega al hacer clic: sus tokens, su tiempo y su actividad. Cada etapa
// del portón trae el porqué. Y la vista dice en qué está el agente —trabajando, con qué rol dentro, o quieto
// porque terminó su turno—, para que una página que no se mueve no parezca colgada.

import test from 'node:test';
import assert from 'node:assert/strict';
import { viewOf, MAX_TASK_ACTIVITY } from '../catalog/live/lib/view.mjs';
import { frameOf, messageOf } from '../catalog/gate/lib/i18n.mjs';

const TASKS = ['- [x] **T1** (R1) — Servicio', '- [ ] **T2** (R1) — HTTP', '- [ ] **T3** — Mutación'].join('\n');
const snapshot = { tasks: { done: 1, total: 3, current: '**T2** (R1) — HTTP' }, gate: {}, review: {}, flow: {}, lang: 'es' };
const USAGE = {
  cursors: {},
  tasks: {
    T1: { input: 10, output: 20, cacheRead: 300, cacheWrite: 40, firstAt: '2026-10-13T10:00:00.000Z', lastAt: '2026-10-13T10:04:30.000Z' },
    T2: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, firstAt: '2026-10-13T10:05:00.000Z', lastAt: '2026-10-13T10:06:00.000Z' },
    '': { input: 5, output: 5, cacheRead: 0, cacheWrite: 0, firstAt: '2026-10-13T09:00:00.000Z', lastAt: '2026-10-13T09:00:00.000Z' }
  }
};
const jsonl = (entries) => entries.map((e) => JSON.stringify(e)).join('\n');
const view = (over = {}) => viewOf({ snapshot, decision: { action: 'work_task', facts: {} }, reason: '', state: null, tasksText: TASKS, activityText: '', usage: USAGE, ...over });

test('R12: each task carries its tokens, with their total, and the time from its first to its last action', () => {
  const [t1, t2, t3] = view().tasks;
  assert.deepEqual(t1.tokens, { input: 10, output: 20, cacheRead: 300, cacheWrite: 40, total: 370 });
  assert.equal(t1.ms, 270_000);
  assert.equal(t1.startedAt, '2026-10-13T10:00:00.000Z');
  assert.deepEqual([t2.tokens.total, t2.ms], [10, 60_000]);
  assert.deepEqual(t3.tokens, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 });
  assert.deepEqual([t3.ms, t3.startedAt], [0, '']);
});

test('R12: the feature totals add everything spent, and what happened outside any task is also shown apart', () => {
  assert.deepEqual(view().totals, {
    tokens: { input: 16, output: 27, cacheRead: 303, cacheWrite: 44, total: 390 },
    ms: 330_000,
    outside: { input: 5, output: 5, cacheRead: 0, cacheWrite: 0, total: 10 }
  });
});

test('R12: without usage recorded every count is zero', () => {
  for (const usage of [undefined, null, {}, { tasks: 'x' }]) {
    const v = view({ usage });
    assert.equal(v.tasks[0].tokens.total, 0, JSON.stringify(usage));
    assert.deepEqual(v.totals.tokens, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 });
  }
});

test('R12: a broken time does not turn into a negative or NaN duration', () => {
  const usage = { tasks: { T1: { input: 1, firstAt: 'x', lastAt: '2026-10-13T10:00:00.000Z' }, T2: { firstAt: '2026-10-13T10:05:00.000Z', lastAt: '2026-10-13T10:00:00.000Z' } } };
  const [t1, t2] = view({ usage }).tasks;
  assert.deepEqual([t1.ms, t2.ms], [0, 0]);
});

test('R11: each task carries its own activity, newest first and capped', () => {
  const entries = [
    { at: '2026-10-13T10:00:00.000Z', who: 'principal', kind: 'tool', tool: 'Read', task: 'T1' },
    { at: '2026-10-13T10:05:00.000Z', who: 'principal', kind: 'tool', tool: 'Bash', task: 'T2' },
    { at: '2026-10-13T10:06:00.000Z', who: 'revisor', kind: 'start', task: 'T2' }
  ];
  const [t1, t2, t3] = view({ activityText: jsonl(entries) }).tasks;
  assert.deepEqual(t1.activity.map((a) => a.tool), ['Read']);
  assert.deepEqual(t2.activity.map((a) => a.who), ['revisor', 'principal']);
  assert.deepEqual(t3.activity, []);
  const many = Array.from({ length: MAX_TASK_ACTIVITY + 4 }, (_, i) => ({ at: `t${i}`, who: 'principal', kind: 'tool', task: 'T1' }));
  const capped = view({ activityText: jsonl(many) }).tasks[0].activity;
  assert.equal(MAX_TASK_ACTIVITY, 40);
  assert.equal(capped.length, MAX_TASK_ACTIVITY);
  assert.equal(capped[0].at, `t${MAX_TASK_ACTIVITY + 3}`);
});

const BLOCKED = { verdict: 'blocked', date: 'd', stages: [
  { stage: 'mutation', ok: false, blocked: true, reason: 'not-installed', findings: 1, details: [{ file: '', line: 0, rule: 'not-installed', data: { tool: 'stryker', install: 'npm i -D x' } }] },
  { stage: 'tests', ok: true, findings: 'x', details: 'x' },
  { stage: 'security', ok: false, findings: 1, details: [{ file: 'src/a.ts', line: 3, rule: 'dynamic-eval' }, null, 'x'] }
] };

test('R10: each gate stage says why, in the words of the report and the language of the project', () => {
  for (const lang of ['es', 'en']) {
    const [mutation, tests, security] = view({ state: BLOCKED, snapshot: { ...snapshot, lang } }).gate.stages;
    assert.equal(mutation.findings, 1);
    assert.deepEqual(mutation.details, [{ file: '', line: 0, rule: 'not-installed', detail: messageOf('not-installed', { tool: 'stryker', install: 'npm i -D x' }, lang) }], lang);
    assert.match(mutation.details[0].detail, /npm i -D x/);
    assert.deepEqual([mutation.title, mutation.status], [frameOf(lang).stages.mutation, frameOf(lang).status.blocked], lang);
    assert.deepEqual([tests.findings, tests.details, tests.status], [0, [], frameOf(lang).status.passed], lang);
    assert.deepEqual(security.details, [{ file: 'src/a.ts', line: 3, rule: 'dynamic-eval', detail: messageOf('dynamic-eval', {}, lang) }], lang);
  }
});

test('R10: a stage the report does not know keeps its own name', () => {
  const state = { verdict: 'pass', date: 'd', stages: [{ stage: 'nueva', ok: true }] };
  assert.equal(view({ state }).gate.stages[0].title, 'nueva');
});

test('R13: the agent is working, with the roles that are inside right now', () => {
  const entries = [
    { at: '2026-10-13T10:00:00.000Z', who: 'principal', kind: 'tool' },
    { at: '2026-10-13T10:01:00.000Z', who: 'seguridad', kind: 'start' },
    { at: '2026-10-13T10:02:00.000Z', who: 'revisor', kind: 'start' },
    { at: '2026-10-13T10:03:00.000Z', who: 'seguridad', kind: 'stop' },
    { at: '2026-10-13T10:04:00.000Z', who: 'revisor', kind: 'tool' }
  ];
  assert.deepEqual(view({ activityText: jsonl(entries) }).agent, { state: 'working', since: '2026-10-13T10:04:00.000Z', inside: ['revisor'] });
});

test('R13: after the end of its turn the agent is waiting, with nobody inside; with no activity, unknown', () => {
  const entries = [
    { at: '2026-10-13T10:00:00.000Z', who: 'revisor', kind: 'start' },
    { at: '2026-10-13T10:05:00.000Z', who: 'principal', kind: 'turn-end' }
  ];
  assert.deepEqual(view({ activityText: jsonl(entries) }).agent, { state: 'waiting', since: '2026-10-13T10:05:00.000Z', inside: [] });
  assert.deepEqual(view().agent, { state: 'none', since: '', inside: [] });
});

test('R13: two copies of a role running at once: one leaving leaves the other inside', () => {
  const entries = [{ at: 'a', who: 'revisor', kind: 'start' }, { at: 'b', who: 'revisor', kind: 'start' }, { at: 'c', who: 'revisor', kind: 'stop' }];
  assert.deepEqual(view({ activityText: jsonl(entries) }).agent.inside, ['revisor']);
  const out = [...entries, { at: 'd', who: 'revisor', kind: 'stop' }, { at: 'e', who: 'revisor', kind: 'stop' }];
  assert.deepEqual(view({ activityText: jsonl(out) }).agent.inside, []);
});

test('R13: the verdict comes in the words of the report too', () => {
  assert.equal(view({ state: BLOCKED }).gate.verdictText, frameOf('es').verdict.blocked);
  assert.equal(view({ state: { verdict: 'pass', stages: [] }, snapshot: { ...snapshot, lang: 'en' } }).gate.verdictText, frameOf('en').verdict.pass);
  assert.equal(view({ state: { verdict: 'raro', stages: [] } }).gate.verdictText, 'raro');
  assert.equal(view({ state: null }).gate.verdictText, '');
});
