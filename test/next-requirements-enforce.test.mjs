// T3 (spec 019, R4, R6) — el revisor revisa requisito por requisito, y el advisor lo exige.
//
// Mismo mecanismo que la checklist OWASP del rol `seguridad` (spec 014): el contrato del rol declara
// `checklist: "requirements"`, y cada entrada suya tiene que decir, de cada `R#` que cita la tarea en curso,
// si se cumple (con archivo:línea del alcance revisado), si no (y entonces no puede ir con `OK`) o por qué
// no aplica. Sin tarea en curso, o con una tarea que no cita requisitos, no se exige nada.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { allReviews } from '../catalog/next/lib/review.mjs';
import { checklistProblems } from '../catalog/next/lib/checklist.mjs';
import { decide } from '../catalog/next/lib/decide.mjs';
import { requirementsOf } from '../catalog/next/lib/tasks.mjs';

const SCOPE = ['src/app.module.ts', 'src/app.saludo.spec.ts'];
const entry = (body, verdict = 'OK') => allReviews(`## 2026-10-13T15:10:00Z · a1b2c3d4e5 · revisor · ${verdict}\n${body}`)[0];
const problems = (body, { verdict, requirements = ['R1', 'R2'] } = {}) =>
  checklistProblems(entry(body, verdict), { kind: 'requirements', scope: SCOPE, requirements });

// ── qué requisitos tiene la tarea ─────────────────────────────────────────────────────────────

test('R4: the requirements of a task are the R# it cites, once each, in order', () => {
  assert.deepEqual(requirementsOf('**T2** (R1, R3) — Exponer por HTTP; ver también R1 y R12'), ['R1', 'R3', 'R12']);
  assert.deepEqual(requirementsOf('**T5** — Mutation testing'), []);
  assert.deepEqual(requirementsOf(''), []);
  assert.deepEqual(requirementsOf(undefined), []);
  assert.deepEqual(requirementsOf('PR1 y R2x no son requisitos, R7 sí'), ['R7']);
});

// ── la checklist ──────────────────────────────────────────────────────────────────────────────

test('R4: one valid line per requirement holds', () => {
  assert.deepEqual(problems(['- R1: cumple — src/app.module.ts:7', '- R2: no aplica — la tarea no cambia el saludo por defecto'].join('\n')), []);
});

test('R4: a missing requirement is a problem', () => {
  assert.deepEqual(problems('- R1: cumple — src/app.module.ts:7'), ['R2: not reviewed']);
});

test('R4: «complies» and «violates» must cite a file:line from the reviewed scope', () => {
  assert.deepEqual(problems(['- R1: cumple — revisado', '- R2: cumple — src/otro.ts:3'].join('\n')), [
    'R1: complies without file:line from the task', 'R2: complies without file:line from the task'
  ]);
});

// Encontrado en el E2E: el revisor real marcó «R3: no cumple — src/app.module.ts:7» (el módulo nuevo sin
// importar). Ese archivo NO está en el alcance justo porque la tarea no lo tocó: el defecto es lo que falta.
test('R4: «violates» may point outside the reviewed scope, but must point somewhere', () => {
  assert.deepEqual(problems(['- R1: no cumple — src/app.module.ts:9', '- R2: cumple — src/app.module.ts:8', '1. x'].join('\n'), { verdict: 'FINDINGS: 1' }), []);
  assert.deepEqual(problems(['- R1: no cumple — src/nunca-tocado.ts:3', '- R2: cumple — src/app.module.ts:8', '1. x'].join('\n'), { verdict: 'FINDINGS: 1' }), []);
  assert.deepEqual(problems(['- R1: no cumple — falta importarlo', '- R2: cumple — src/app.module.ts:8', '1. x'].join('\n'), { verdict: 'FINDINGS: 1' }), ['R1: violates without file:line']);
});

test('R4: «not applicable» needs a reason of at least three words', () => {
  assert.deepEqual(problems(['- R1: cumple — src/app.module.ts:7', '- R2: no aplica — no'].join('\n')), ['R2: not applicable without a reason']);
});

test('R4: a requirement that is violated cannot go with OK', () => {
  assert.deepEqual(problems(['- R1: no cumple — src/app.module.ts:7', '- R2: cumple — src/app.module.ts:8'].join('\n')), ['R1: violates but the verdict is OK']);
  assert.deepEqual(problems(['- R1: no cumple — src/app.module.ts:7', '- R2: cumple — src/app.module.ts:8', '1. src/app.module.ts:7 — [spec] el módulo no se importa'].join('\n'), { verdict: 'FINDINGS: 1' }), []);
});

test('R4: FINDINGS: n must match the numbered items, as in every checklist', () => {
  assert.deepEqual(problems(['- R1: no cumple — src/app.module.ts:7', '- R2: cumple — src/app.module.ts:8'].join('\n'), { verdict: 'FINDINGS: 2' }).at(-1), 'FINDINGS: 2 but 0 numbered item(s)');
});

test('R6: without requirements nothing is demanded', () => {
  assert.deepEqual(problems('', { requirements: [] }), []);
});

// ── el advisor ────────────────────────────────────────────────────────────────────────────────

const GATE = Date.parse('2026-10-13T15:00:00Z');
const ROLES = [{ id: 'revisor', order: 10, cadence: 'task', required: true, checklist: 'requirements' }];
const snap = (log, current = '**T2** (R1, R2) — Exponer por HTTP') => ({
  tasks: { hasTasksFile: true, done: 1, total: 2, current, mtime: GATE - 1 },
  gate: { exists: true, date: GATE, verdict: 'pass', fast: false, scopeHash: 'h', currentScopeHash: 'h', scopeFiles: SCOPE, branch: 'b', pending: [] },
  review: { entries: allReviews(log) },
  changed: { files: SCOPE, newestMtime: GATE - 10 },
  flow: { approvals: { task: true, feature: true }, roles: ROLES },
  git: { isRepo: true, branch: 'b' },
  problems: []
});
const LOG = (body) => `## 2026-10-13T15:10:00Z · a1b2c3d4e5 · revisor · OK\n${body}`;

test('R4: the advisor lets the task close only when every requirement is answered', () => {
  assert.equal(decide(snap(LOG(['- R1: cumple — src/app.module.ts:7', '- R2: cumple — src/app.saludo.spec.ts:6'].join('\n')))).action, 'tick_task');
  const result = decide(snap(LOG('- R1: cumple — src/app.module.ts:7')));
  assert.equal(result.action, 'ask_human');
  assert.ok(result.facts.problems.some((p) => /revisor/.test(p) && /R2: not reviewed/.test(p)), JSON.stringify(result.facts));
});

test('R6: with everything ticked, or a task without requirements, no requirement line is demanded', () => {
  assert.equal(decide(snap(LOG(''), '**T3** — Mutation testing')).action, 'tick_task');
  const done = { ...snap(LOG('')), tasks: { hasTasksFile: true, done: 2, total: 2, current: '', mtime: GATE - 1 } };
  assert.equal(decide(done).action, 'done');
});

test('R4: the reviewer contract declares the requirements checklist', async () => {
  const contract = JSON.parse(await readFile(new URL('../catalog/agents/revisor/contract.json', import.meta.url), 'utf8'));
  assert.equal(contract.checklist, 'requirements');
});

// Los casos de abajo salen de la pasada de mutación.

test('R4: exactly three words are enough as a reason', () => {
  assert.deepEqual(problems(['- R1: cumple — src/app.module.ts:7', '- R2: no aplica — fuera del alcance'].join('\n')), []);
});

test('R4: an entry read without requirement or checklist lines does not break the check', () => {
  assert.deepEqual(checklistProblems({ ok: true }, { kind: 'requirements', scope: SCOPE, requirements: ['R1'] }), ['R1: not reviewed']);
  assert.deepEqual(checklistProblems({ ok: true }, { kind: 'owasp', scope: SCOPE }).length, 10);
});

test('R4: an unknown kind of checklist is reported, not guessed', () => {
  assert.deepEqual(checklistProblems(entry(''), { kind: 'nope', scope: SCOPE }), ['unknown checklist "nope"']);
});

test('R6: without a list of requirements nothing is demanded', () => {
  assert.deepEqual(checklistProblems(entry(''), { kind: 'requirements', scope: SCOPE }), []);
});

test('R4: a scope with Windows separators still matches the cited files', () => {
  assert.deepEqual(checklistProblems(entry('- R1: cumple — src/app.module.ts:7'), { kind: 'requirements', scope: ['src\\app.module.ts'], requirements: ['R1'] }), []);
});
