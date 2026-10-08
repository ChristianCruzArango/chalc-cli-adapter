// F-07 — la evidencia del portón queda atada a lo que revisó y no se puede estirar ni copiar.
//
// Lo que la auditoría encontró: una fecha futura dejaba la evidencia vigente para siempre; el estado
// no estaba ligado ni al commit ni al contenido; una entrada de review.md con cualquier commit valía;
// y relajar gate.json (mutation.required:false, test.command:"true") cerraba la tarea en verde sin
// que la evidencia lo dijera.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { runGate } from '../catalog/gate/gate.mjs';
import { sealBaseline } from '../catalog/gate/lib/baseline.mjs';
import { configChanges, guardedConfig, scopeHash } from '../catalog/gate/lib/fingerprint.mjs';
import { parseGateState } from '../catalog/next/lib/state.mjs';
import { snapshot } from '../catalog/next/lib/snapshot.mjs';
import { decide } from '../catalog/next/lib/decide.mjs';
import { loadConfig } from '../catalog/gate/lib/config.mjs';

const CONFIG = {
  stack: 'js',
  test: { command: 'npm test' },
  mutation: { tool: '', command: '', report: '', format: '', threshold: 80, required: false, scopeFlag: '' },
  lint: { maxFileLines: 300, maxFunctionLines: 40, maxParams: 4, maxDepth: 3, duplication: { enabled: false } },
  spec: { dir: 'specs' },
  role: 'back',
  language: 'es'
};
const run = async () => ({ code: 0, ms: 1 });
const git = (dir, ...args) => spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8' }).stdout.trim();

async function project() {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-f07-'));
  const files = {
    '.chalc/gate.json': JSON.stringify(CONFIG),
    'specs/001-x/spec.md': '- **R1** — WHEN x THE SYSTEM SHALL y.',
    'specs/001-x/tasks.md': '- [ ] T1 — pagar\n',
    'src/base.ts': 'export const base = () => 1;\n'
  };
  for (const [rel, content] of Object.entries(files)) {
    await mkdir(dirname(join(dir, rel)), { recursive: true });
    await writeFile(join(dir, rel), content);
  }
  git(dir, 'init', '-q', '-b', 'main', '.');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'base');
  // Como al cerrar una tarea real: lo sellado es la config CARGADA, con sus valores por defecto.
  await sealBaseline(dir, { commit: git(dir, 'rev-parse', 'HEAD'), config: guardedConfig((await loadConfig(dir)).config) });
  await writeFile(join(dir, 'src', 'pago.ts'), 'export const pago = () => 2;\n');
  return dir;
}

test('the state records the evaluated commit and a fingerprint of the reviewed content', async () => {
  const dir = await project();
  await runGate({ root: dir, run, fast: true });
  const state = JSON.parse(await readFile(join(dir, '.chalc', 'gate.state.json'), 'utf8'));
  assert.equal(state.head, git(dir, 'rev-parse', 'HEAD'));
  assert.equal(state.scopeHash, await scopeHash(dir, ['src/pago.ts']));
});

test('editing the reviewed code after the gate makes the evidence stale', async () => {
  const dir = await project();
  await runGate({ root: dir, run, fast: false });
  const before = await snapshot(dir);
  assert.equal(before.gate.scopeHash, before.gate.currentScopeHash);

  await writeFile(join(dir, 'src', 'pago.ts'), 'export const pago = () => 3;\n');
  const after = await snapshot(dir);
  assert.notEqual(after.gate.scopeHash, after.gate.currentScopeHash);
  assert.equal(decide(after).action, 'run_gate');
});

test('a gate state dated in the future is not evidence', () => {
  const now = Date.parse('2026-10-08T12:00:00Z');
  const future = JSON.stringify({ date: '2099-01-01T00:00:00Z', verdict: 'pass', fast: false });
  const skewed = JSON.stringify({ date: '2026-10-08T12:03:00Z', verdict: 'pass', fast: false });
  assert.equal(parseGateState(future, { now }).exists, false);
  assert.equal(parseGateState(skewed, { now }).exists, true);
});

const ROLES = [{ id: 'revisor', order: 10, cadence: 'task', required: true }];
const facts = (entry, { now = 10_000_000 } = {}) => ({
  tasks: { hasTasksFile: true, done: 0, total: 2, current: 'T1', mtime: 0 },
  gate: { exists: true, date: 5_000_000, verdict: 'pass', fast: false, branch: 'main', pending: [], scopeHash: 'h', currentScopeHash: 'h', head: 'abcdef1234567890' },
  review: { entries: [entry] },
  changed: { files: ['src/a.ts'], newestMtime: 1 },
  flow: { approvals: { task: true, feature: true }, roles: ROLES },
  git: { isRepo: true, branch: 'main', head: 'abcdef1234567890' },
  now,
  problems: []
});
const entry = (over) => ({ role: 'revisor', date: 6_000_000, ok: true, findings: 0, commit: 'abcdef1', ...over });

test('a review entry only counts for the evaluated or current commit, and never from the future', () => {
  assert.equal(decide(facts(entry())).action, 'tick_task');
  assert.equal(decide(facts(entry({ commit: '0000000' }))).action, 'call_role');
  assert.equal(decide(facts(entry({ commit: 'abc' }))).action, 'call_role');
  assert.equal(decide(facts(entry({ date: 99_000_000 }))).action, 'call_role');
});

test('relaxing gate.json since the last closed task is reported in the evidence and the state', async () => {
  assert.deepEqual(configChanges(guardedConfig(CONFIG), { ...CONFIG, test: { command: 'true' } }), ['test.command']);
  const dir = await project();
  await writeFile(join(dir, '.chalc', 'gate.json'), JSON.stringify({ ...CONFIG, mutation: { ...CONFIG.mutation, threshold: 0 } }));
  await runGate({ root: dir, run, fast: true });
  const state = JSON.parse(await readFile(join(dir, '.chalc', 'gate.state.json'), 'utf8'));
  assert.deepEqual(state.configChanges, ['mutation.threshold']);
  assert.match(await readFile(join(dir, '.chalc', 'gate.md'), 'utf8'), /gate\.json` cambió .*`mutation\.threshold`/);
});
