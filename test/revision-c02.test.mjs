// C-02 (spec 016, R17) — un fallo de git no se interpreta como «limpio y sin upstream»: con el índice
// corrupto, `git status` falla y el preflight se bloquea con motivo explícito. Los casos NORMALES
// (repo sin commits, rama sin upstream, repo limpio) siguen igual que antes.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitStatus, safePull, upstreamProblem } from '../lib/gitprep.mjs';
import { workspaceGate } from '../lib/workspace.mjs';
import { t } from '../lib/i18n.mjs';

async function repo({ commit = true } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-c02-'));
  const run = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' });
  run('init', '-q', '-b', 'main');
  if (commit) {
    await writeFile(join(dir, 'a.txt'), 'x\n');
    run('add', 'a.txt');
    run('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init');
  }
  return dir;
}

test('R17: a corrupted index is an explicit git error, never "clean" (report scenario)', async () => {
  const dir = await repo();
  await writeFile(join(dir, '.git', 'index'), 'invalid-index');
  const status = await gitStatus(dir);
  assert.equal(status.clean, false);
  assert.match(status.error, /status/);
  const pull = await safePull(dir);
  assert.deepEqual([pull.ok, pull.reason], [false, 'git-error']);
  const gate = await workspaceGate([{ name: 'back', path: dir }]);
  assert.equal(gate.ok, false);
  assert.equal(gate.results[0].reason, 'git-error');
});

test('R17: normal cases keep working — clean repo without upstream passes the gate', async () => {
  const dir = await repo();
  const status = await gitStatus(dir);
  assert.deepEqual([status.clean, status.hasUpstream, status.error], [true, false, undefined]);
  assert.equal((await safePull(dir)).reason, 'no-upstream');
  assert.equal((await workspaceGate([{ name: 'back', path: dir }])).ok, true);
});

test('R17: a repo without commits is not a git error', async () => {
  const dir = await repo({ commit: false });
  const status = await gitStatus(dir);
  assert.equal(status.isRepo, true);
  assert.equal(status.error, undefined);
  assert.equal(status.clean, true);
});

test('R17: a dirty tree is still reported as dirty, not as an error', async () => {
  const dir = await repo();
  await writeFile(join(dir, 'b.txt'), 'nuevo\n');
  const status = await gitStatus(dir);
  assert.deepEqual([status.clean, status.error], [false, undefined]);
  assert.equal((await safePull(dir)).reason, 'dirty');
});

test('R17: the new reason has its own translated text', () => {
  assert.notEqual(t('gitReason_git_error'), 'gitReason_git_error');
});

test('R17: a real upstream is not an error and reports ahead/behind', async () => {
  const remote = await mkdtemp(join(tmpdir(), 'chalc-c02-remote-'));
  execFileSync('git', ['init', '-q', '--bare', remote], { stdio: 'ignore' });
  const dir = await repo();
  const run = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' });
  run('remote', 'add', 'origin', remote);
  run('push', '-q', '-u', 'origin', 'main');
  const status = await gitStatus(dir);
  assert.deepEqual([status.hasUpstream, status.error, status.clean, status.ahead, status.behind], [true, undefined, true, 0, 0]);
  assert.equal((await safePull(dir)).reason, 'up-to-date');
});

test('R17: upstream failures are classified with the messages git really prints', () => {
  assert.equal(upstreamProblem({ code: 0, err: '' }), false);
  assert.equal(upstreamProblem({ code: 128, err: "fatal: no upstream configured for branch 'main'" }), false);
  assert.equal(upstreamProblem({ code: 128, err: "fatal: no such branch: 'main'" }), false);
  assert.equal(upstreamProblem({ code: 128, err: "fatal: upstream branch 'refs/heads/main' not stored as a remote-tracking branch" }), false);
  assert.equal(upstreamProblem({ code: 128, err: 'fatal: bad object HEAD' }), true);
  assert.equal(upstreamProblem({ code: -1, err: 'git no disponible' }), true);
  assert.equal(upstreamProblem({ code: 1 }), true);
});

test('R17: a broken upstream configuration (points to a missing local branch) blocks with its reason', async () => {
  const dir = await repo();
  const run = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' });
  run('config', 'branch.main.remote', '.');
  run('config', 'branch.main.merge', 'refs/heads/nope');
  const status = await gitStatus(dir);
  assert.match(status.error, /^upstream-failed: /);
  assert.equal((await safePull(dir)).reason, 'git-error');
});
