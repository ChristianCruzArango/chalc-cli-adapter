import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { gitStatus, safePull, createFeatureBranch } from '../lib/gitprep.mjs';

function sh(args, cwd) { execFileSync('git', args, { cwd, stdio: 'ignore' }); }
async function repo() {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-git-'));
  sh(['init', '-q'], dir);
  sh(['config', 'user.email', 'a@b.c'], dir);
  sh(['config', 'user.name', 'Test'], dir);
  sh(['config', 'commit.gpgsign', 'false'], dir);
  await writeFile(join(dir, 'README.md'), '# x', 'utf8');
  sh(['add', '.'], dir);
  sh(['commit', '-q', '-m', 'init'], dir);
  return dir;
}

test('gitStatus distinguishes a non-repo from a clean repo', async () => {
  const notRepo = await mkdtemp(join(tmpdir(), 'chalc-nogit-'));
  assert.equal((await gitStatus(notRepo)).isRepo, false);
  const r = await repo();
  const s = await gitStatus(r);
  assert.equal(s.isRepo, true);
  assert.equal(s.clean, true);
  assert.equal(s.hasUpstream, false);   // repo local sin remoto
});

test('safePull stops safely without touching anything', async () => {
  assert.equal((await safePull(await mkdtemp(join(tmpdir(), 'chalc-nogit-')))).reason, 'not-a-repo');
  assert.equal((await safePull(await repo())).reason, 'no-upstream');
  const dirty = await repo();
  await writeFile(join(dirty, 'README.md'), '# changed', 'utf8');
  assert.equal((await safePull(dirty)).reason, 'dirty');   // árbol sucio → no toca
});

test('createFeatureBranch creates and switches to a feature branch', async () => {
  const r = await repo();
  const created = await createFeatureBranch(r, 'feat/001-login');
  assert.equal(created.ok, true);
  assert.equal(created.reason, 'created');
  assert.equal((await gitStatus(r)).branch, 'feat/001-login');
  // reejecutar = ya estás en la rama → 'switched', sin error
  assert.equal((await createFeatureBranch(r, 'feat/001-login')).reason, 'switched');
});
