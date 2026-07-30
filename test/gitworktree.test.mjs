import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { addWorktree } from '../lib/gitworktree.mjs';

function sh(args, cwd) { return execFileSync('git', args, { cwd, encoding: 'utf8' }); }
async function repo() {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-wt-'));
  sh(['init', '-q'], dir);
  sh(['config', 'user.email', 'a@b.c'], dir);
  sh(['config', 'user.name', 'Test'], dir);
  sh(['config', 'commit.gpgsign', 'false'], dir);
  await writeFile(join(dir, 'README.md'), '# x', 'utf8');
  sh(['add', '.'], dir);
  sh(['commit', '-q', '-m', 'init'], dir);
  return dir;
}

// R9 — crea el worktree en el destino con una rama NUEVA feat/<slug>.
test('addWorktree creates a worktree on a new branch', async () => {
  const r = await repo();
  const dest = join(await mkdtemp(join(tmpdir(), 'chalc-ws-')), 'back');
  const res = await addWorktree(r, dest, 'feat/login');
  assert.equal(res.ok, true);
  assert.equal(res.reason, 'created');
  assert.ok(existsSync(join(dest, 'README.md')), 'el worktree tiene el contenido del repo');
  assert.equal(sh(['rev-parse', '--abbrev-ref', 'HEAD'], dest).trim(), 'feat/login');
  // el repo principal sigue en su rama original, sin tocar
  assert.notEqual(sh(['rev-parse', '--abbrev-ref', 'HEAD'], r).trim(), 'feat/login');
});

// R9 — si la rama ya existe, la REUSA (no pisa trabajo ni usa --force).
test('addWorktree reuses an existing branch', async () => {
  const r = await repo();
  sh(['branch', 'feat/login'], r);
  const dest = join(await mkdtemp(join(tmpdir(), 'chalc-ws-')), 'back');
  const res = await addWorktree(r, dest, 'feat/login');
  assert.equal(res.ok, true);
  assert.equal(res.reason, 'created-existing-branch');
  assert.equal(sh(['rev-parse', '--abbrev-ref', 'HEAD'], dest).trim(), 'feat/login');
});

// R10 — no-repo y destino ya existente: se detiene y reporta, sin crear nada.
test('addWorktree stops safely on non-repo and existing destination', async () => {
  const notRepo = await mkdtemp(join(tmpdir(), 'chalc-nogit-'));
  const dest1 = join(await mkdtemp(join(tmpdir(), 'chalc-ws-')), 'back');
  assert.equal((await addWorktree(notRepo, dest1, 'feat/x')).reason, 'not-a-repo');
  assert.ok(!existsSync(dest1), 'no crea el destino si el origen no es repo');

  const r = await repo();
  const dest2 = join(await mkdtemp(join(tmpdir(), 'chalc-ws-')), 'back');
  await mkdir(dest2, { recursive: true });
  const res = await addWorktree(r, dest2, 'feat/x');
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'dest-exists');
});

// R10 — una rama ya montada en OTRO worktree no se puede montar dos veces: reporta, no fuerza.
test('addWorktree reports add-failed when the branch is already checked out elsewhere', async () => {
  const r = await repo();
  const base = await mkdtemp(join(tmpdir(), 'chalc-ws-'));
  assert.equal((await addWorktree(r, join(base, 'a'), 'feat/dup')).ok, true);
  const res = await addWorktree(r, join(base, 'b'), 'feat/dup');
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'add-failed');
});
