// T17 (spec 020, R15) — un rol puede citar cualquier archivo que la tarea cambió, no solo el código.
//
// Encontrado en el segundo E2E del tablero: `seguridad` revisó A05 (configuración) citando `stryker.conf.json`,
// que la propia tarea creó, y el advisor respondió `ask_human` porque solo aceptaba el código que mide el
// portón. La configuración ES de la tarea si la tarea la tocó. Lo que la tarea no tocó, y lo propio de chalc
// (`.chalc/`), sigue sin valer como cita.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { taskScope } from '../catalog/gate/lib/changed.mjs';
import { touchedFiles } from '../catalog/gate/lib/scope.mjs';
import { allReviews } from '../catalog/next/lib/review.mjs';
import { decide } from '../catalog/next/lib/decide.mjs';

const git = (dir, args) => new Promise((done) => {
  const child = spawn('git', args, { cwd: dir, stdio: 'ignore' });
  child.on('error', () => done());
  child.on('close', () => done());
});
async function write(dir, rel, text = 'x\n') {
  await mkdir(dirname(join(dir, rel)), { recursive: true });
  await writeFile(join(dir, rel), text);
}

test('R15: the task scope also lists every file the task touched, config included, but not .chalc', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-touched-'));
  await git(dir, ['init', '-q', '-b', 'main', '.']);
  await git(dir, ['config', 'user.email', 't@chalc.dev']);
  await git(dir, ['config', 'user.name', 't']);
  await git(dir, ['config', 'commit.gpgsign', 'false']);
  await write(dir, 'README.md');
  await git(dir, ['add', '-A']);
  await git(dir, ['commit', '-q', '-m', 'base']);
  await write(dir, 'src/a.ts', 'export const a = 1;\n');
  await write(dir, 'stryker.conf.json', '{}\n');
  await write(dir, '.chalc/review.md', '# r\n');
  const scope = await taskScope(dir);
  assert.deepEqual(scope.files, ['src/a.ts']);
  assert.deepEqual(scope.touched, ['src/a.ts', 'stryker.conf.json']);
});

test('R15: without git nothing is known to be touched', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-touched-'));
  assert.deepEqual((await taskScope(dir)).touched, []);
});

test('R15: touched files are normalized, unique, sorted, and come from the registry and the diff', () => {
  assert.deepEqual(touchedFiles(['src\\b.ts', ' a.json ', '', null], ['src/b.ts', 'c.md', '.chalc/gate.md']), ['a.json', 'c.md', 'src/b.ts']);
  assert.deepEqual(touchedFiles(['x.yml'], null), ['x.yml']);
  assert.deepEqual(touchedFiles(null, ['y.yml']), ['y.yml']);
  assert.deepEqual(touchedFiles(), []);
});

test('R15: with the touched list in the snapshot, anything only in it counts; nothing else is invented', () => {
  const s = snap('stryker.conf.json:5', ['stryker.conf.json']);
  s.changed.files = [];
  s.gate.scopeFiles = ['src/saludo.controller.ts'];
  assert.equal(decide(s).action, 'tick_task');
});

const GATE = Date.parse('2026-10-13T23:02:39Z');
const OWASP = ['A01', 'A02', 'A03', 'A04', 'A05', 'A06', 'A07', 'A08', 'A09', 'A10'];
const entry = (a05) => ['## 2026-10-13T23:02:48Z · dc7e13bd88 · seguridad · OK',
  ...OWASP.map((id) => (id === 'A05' ? `- A05 Configuración: revisado — ${a05}` : `- ${id} Categoría: revisado — src/saludo.controller.ts:5`))].join('\n');
const snap = (a05, touched = ['src/saludo.controller.ts', 'stryker.conf.json']) => ({
  tasks: { hasTasksFile: true, done: 0, total: 3, current: 'T1 — Controller', mtime: GATE - 1 },
  gate: { exists: true, date: GATE, verdict: 'pass', fast: false, scopeHash: 'h', currentScopeHash: 'h', scopeFiles: ['src/saludo.controller.ts'], branch: 'b', pending: [] },
  review: { entries: allReviews(entry(a05)) },
  changed: { files: ['src/saludo.controller.ts'], touched, newestMtime: GATE - 10 },
  flow: { approvals: { task: true, feature: true }, roles: [{ id: 'seguridad', order: 5, cadence: 'task', required: true, checklist: 'owasp' }] },
  git: { isRepo: true, branch: 'b' },
  platform: { mobile: false },
  problems: []
});

test('R15: a checklist that cites a config file the task touched holds', () => {
  assert.equal(decide(snap('stryker.conf.json:5, stryker.conf.json:6')).action, 'tick_task');
});

test('R15: a file the task did not touch still does not count', () => {
  const result = decide(snap('tsconfig.json:3'));
  assert.equal(result.action, 'ask_human');
  assert.ok(result.facts.problems.some((p) => /A05: reviewed without file:line from the task/.test(p)));
});

test('R15: a snapshot without the touched list keeps validating against the measured scope', () => {
  const s = snap('stryker.conf.json:5');
  delete s.changed.touched;
  assert.equal(decide(s).action, 'ask_human');
  assert.equal(decide(snap('src/saludo.controller.ts:5', undefined)).action, 'tick_task');
});

test('R15: a requirement complied with in a config file the task touched holds too', () => {
  const s = snap('src/saludo.controller.ts:5');
  s.flow.roles = [{ id: 'revisor', order: 10, cadence: 'task', required: true, checklist: 'requirements' }];
  s.tasks.current = '**T1** (R1) — Controller';
  s.review.entries = allReviews(['## 2026-10-13T23:02:48Z · dc7e13bd88 · revisor · OK', '- R1: cumple — stryker.conf.json:2'].join('\n'));
  assert.equal(decide(s).action, 'tick_task');
});
