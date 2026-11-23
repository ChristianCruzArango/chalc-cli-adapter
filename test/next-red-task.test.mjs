// Spec 030 (rojo sellado), T5 — el advisor manda primero los tests (R11): con una tarea en curso y sin su rojo
// registrado responde `red_task`; con él, `work_task`. Lo sabe por `.chalc/tdd.jsonl`, no por la memoria de nadie.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { coherentSpec } from './helpers/coherentspec.mjs';
import { READY_SPECS } from './helpers/readyspecs.mjs';
import { decide } from '../catalog/next/lib/decide.mjs';
import { ACTIONS, commandOf } from '../catalog/next/lib/actions.mjs';
import { FRAME, reasonOf } from '../catalog/next/lib/i18n.mjs';
import { snapshot } from '../catalog/next/lib/snapshot.mjs';

const GATE = Date.parse('2026-11-22T11:00:00.000Z');
const ROLES = [{ id: 'revisor', order: 10, cadence: 'task', required: true }];
const snap = (over = {}) => ({
  specs: READY_SPECS,
  tdd: over.tdd,
  tasks: { hasTasksFile: true, done: 0, total: 2, current: '**T1** (R1, R2) — cobro', mtime: GATE + 1, ...over.tasks },
  gate: { exists: false, pending: [], ...over.gate },
  review: { entries: [] },
  changed: { files: [], newestMtime: 0, ...over.changed },
  flow: { review: { required: true }, roles: ROLES },
  git: { isRepo: true, branch: 'main', head: 'abc1234' },
  now: GATE + 5000
});

test('R11: con una tarea en curso y sin rojo registrado → red_task, con la tarea y sus requisitos', () => {
  const out = decide(snap({ tdd: { red: false } }));
  assert.equal(out.action, 'red_task');
  assert.deepEqual({ task: out.facts.task, done: out.facts.done, total: out.facts.total, requirements: out.facts.requirements },
    { task: '**T1** (R1, R2) — cobro', done: 0, total: 2, requirements: ['R1', 'R2'] });
});

test('R11: con el rojo registrado → work_task', () => {
  assert.equal(decide(snap({ tdd: { red: true } })).action, 'work_task');
});

test('R11: sin saber si hay rojo (snapshot sin ese hecho) se pide el rojo: «no sé» no vale como «ya está»', () => {
  assert.equal(decide(snap()).action, 'red_task');
});

test('R11: lo que ya había que atender va antes: medir, arreglar y marcar', () => {
  const noRed = { tdd: { red: false } };
  assert.equal(decide(snap({ ...noRed, changed: { files: ['src/a.ts'], newestMtime: GATE } })).action, 'run_gate');
  const pass = { exists: true, date: GATE, verdict: 'pass', fast: false, scopeHash: 'h', currentScopeHash: 'h', branch: 'main', head: 'abc1234', pending: [] };
  assert.equal(decide(snap({ ...noRed, gate: { ...pass, verdict: 'fail' } })).action, 'fix_gate');
  assert.equal(decide(snap({ ...noRed, gate: pass, tasks: { mtime: GATE - 1 } })).action, 'call_role');
});

test('R11: sin tarea en curso no se pide ningún rojo', () => {
  const out = decide(snap({ tdd: { red: false }, tasks: { done: 2, current: '' } }));
  assert.notEqual(out.action, 'red_task');
});

test('el vocabulario incluye red_task justo antes de work_task, con el comando del rojo', () => {
  assert.equal(ACTIONS.indexOf('red_task'), ACTIONS.indexOf('work_task') - 1);
  assert.equal(commandOf('red_task'), 'node .chalc/gate.mjs --red');
  assert.equal(commandOf('red_task', { gatePath: '../back/.chalc/gate.mjs' }), 'node ../back/.chalc/gate.mjs --red');
});

test('R11: el motivo manda SOLO los tests, nombra los requisitos y dice cómo declarar una tarea sin tests', () => {
  const facts = { task: '**T1** (R1, R2) — cobro', done: 0, total: 2, requirements: ['R1', 'R2'], memory: [] };
  for (const lang of ['es', 'en']) {
    assert.equal(typeof FRAME[lang].reason.red_task, 'function');
    const reason = reasonOf('red_task', facts, lang);
    assert.ok(reason.includes('R1, R2') && reason.includes('--skip'), reason);
  }
  assert.match(reasonOf('red_task', facts, 'es'), /SOLO los tests/);
  assert.match(reasonOf('red_task', facts, 'en'), /ONLY the tests/);
});

// ── con el repo de verdad ─────────────────────────────────────────────────────────────────────────

async function repo(t, { red }) {
  const root = await tempDir(t, 'chalc-030-next-');
  const files = { '.chalc/gate.json': JSON.stringify({ spec: { dir: 'specs' }, language: 'es' }), ...coherentSpec('specs/001-demo', { red }) };
  for (const [rel, content] of Object.entries(files)) { await mkdir(dirname(join(root, ...rel.split('/'))), { recursive: true }); await writeFile(join(root, ...rel.split('/')), content); }
  return root;
}
const read = (root) => snapshot(root, { changed: async () => [], branch: async () => 'main', head: async () => 'abc1234' });

test('R11: el snapshot dice si la tarea en curso tiene su rojo registrado', async (t) => {
  assert.deepEqual((await read(await repo(t, { red: false }))).tdd, { red: false });
  assert.deepEqual((await read(await repo(t, { red: true }))).tdd, { red: true });
});

test('R11: una exención registrada también cuenta: la tarea ya declaró que no lleva tests', async (t) => {
  const root = await repo(t, { red: false });
  await writeFile(join(root, '.chalc', 'tdd.jsonl'), JSON.stringify({ task: 'specs/001-demo#T1', kind: 'skip', date: 'd', reason: 'solo cambia la documentación' }) + '\n');
  assert.deepEqual((await read(root)).tdd, { red: true });
  await writeFile(join(root, '.chalc', 'tdd.jsonl'), JSON.stringify({ task: 'specs/001-demo#T9', kind: 'red', date: 'd', tests: {} }) + '\n');
  assert.deepEqual((await read(root)).tdd, { red: false }, 'el de otra tarea no cuenta');
});
