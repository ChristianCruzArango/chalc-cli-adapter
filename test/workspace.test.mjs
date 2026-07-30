import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  workspaceGate, planWorkspace, createWorkspace, writeHandoff,
  rememberWorkspaceDir, recallWorkspaceDir, workspaceBaseDir
} from '../lib/workspace.mjs';

function sh(args, cwd) { execFileSync('git', args, { cwd, stdio: 'ignore' }); }
async function repo() {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-ws-repo-'));
  sh(['init', '-q'], dir);
  sh(['config', 'user.email', 'a@b.c'], dir);
  sh(['config', 'user.name', 'Test'], dir);
  sh(['config', 'commit.gpgsign', 'false'], dir);
  await writeFile(join(dir, 'README.md'), '# x', 'utf8');
  sh(['add', '.'], dir);
  sh(['commit', '-q', '-m', 'init'], dir);
  return dir;
}

// R3 — pasa con árbol limpio aunque no haya upstream (repo local legítimo).
test('workspaceGate passes clean repos without upstream', async () => {
  const back = await repo(), front = await repo();
  const gate = await workspaceGate([{ name: 'back', path: back }, { name: 'front', path: front }]);
  assert.equal(gate.ok, true);
  assert.deepEqual(gate.results.map((r) => r.ok), [true, true]);
  assert.equal(gate.results[0].reason, 'no-upstream');
});

// R3, R4 — un repo sucio bloquea la puerta y reporta el motivo POR repo.
test('workspaceGate fails and names the dirty repo', async () => {
  const back = await repo(), front = await repo();
  await writeFile(join(front, 'README.md'), '# changed', 'utf8');
  const gate = await workspaceGate([{ name: 'back', path: back }, { name: 'front', path: front }]);
  assert.equal(gate.ok, false);
  const bad = gate.results.find((r) => !r.ok);
  assert.equal(bad.name, 'front');
  assert.equal(bad.reason, 'dirty');
});

// R4 — un no-repo también bloquea (reason de safePull, sin excepción).
test('workspaceGate fails on a non-repo path', async () => {
  const gate = await workspaceGate([{ name: 'back', path: await mkdtemp(join(tmpdir(), 'chalc-nogit-')) }]);
  assert.equal(gate.ok, false);
  assert.equal(gate.results[0].reason, 'not-a-repo');
});

// R8 — cualquier ruta del usuario aterriza SIEMPRE en su subcarpeta chalc-workspaces
// (se añade si falta, no se duplica si ya termina en ella — también en MAYÚSCULAS de Windows).
test('workspaceBaseDir always lands on a chalc-workspaces subfolder without doubling it', () => {
  assert.equal(workspaceBaseDir('D:\\MVM'), join('D:\\MVM', 'chalc-workspaces'));
  assert.equal(workspaceBaseDir('D:/MVM/chalc-workspaces'), 'D:/MVM/chalc-workspaces');
  assert.equal(workspaceBaseDir('D:/MVM/CHALC-WORKSPACES'), 'D:/MVM/CHALC-WORKSPACES');
});

// R8, R9 — el plan calcula <base>/NNN-slug/{back,front,movil} sin tocar disco.
test('planWorkspace lays out <base>/<id>/<side> without touching disk', async () => {
  const base = join(tmpdir(), 'chalc-plan-never-created');
  const plan = planWorkspace(base, '005-login', [
    { name: 'back', path: '/repos/api' }, { name: 'front', path: '/repos/web' }, { name: 'movil', path: '/repos/app' }
  ]);
  assert.equal(plan.dir, join(base, '005-login'));
  assert.deepEqual(plan.sides.map((s) => s.name), ['back', 'front', 'movil']);
  assert.equal(plan.sides[0].repo, '/repos/api');
  assert.equal(plan.sides[1].dest, join(base, '005-login', 'front'));
  assert.ok(!existsSync(base), 'planWorkspace no escribe nada');
});

// R9 — crea el workspace completo: un worktree por lado, todos en la rama de la feature.
test('createWorkspace creates one worktree per side on the feature branch', async () => {
  const back = await repo(), front = await repo();
  const base = await mkdtemp(join(tmpdir(), 'chalc-ws-base-'));
  const plan = planWorkspace(base, '005-login', [{ name: 'back', path: back }, { name: 'front', path: front }]);
  const res = await createWorkspace(plan, 'feat/login');
  assert.equal(res.ok, true);
  assert.equal(res.failures.length, 0);
  assert.deepEqual(res.created.map((s) => s.name), ['back', 'front']);
  for (const side of ['back', 'front']) {
    const dest = join(base, '005-login', side);
    assert.ok(existsSync(join(dest, 'README.md')), `${side} montado`);
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dest, encoding: 'utf8' }).trim();
    assert.equal(branch, 'feat/login');
  }
});

// R10 — todo-o-nada por pre-flight: si UN lado no es repo, NO se crea ningún worktree.
test('createWorkspace is all-or-nothing: one bad side prevents every worktree', async () => {
  const back = await repo();
  const notRepo = await mkdtemp(join(tmpdir(), 'chalc-nogit-'));
  const base = await mkdtemp(join(tmpdir(), 'chalc-ws-base-'));
  const plan = planWorkspace(base, '005-login', [{ name: 'back', path: back }, { name: 'front', path: notRepo }]);
  const res = await createWorkspace(plan, 'feat/login');
  assert.equal(res.ok, false);
  assert.equal(res.failures[0].name, 'front');
  assert.equal(res.failures[0].reason, 'not-a-repo');
  assert.ok(!existsSync(join(base, '005-login', 'back')), 'no montó el lado bueno');
});

// R10 — si git falla DESPUÉS del pre-flight (rama montada en otro worktree), se reporta el fallo
// y no se marca como creado lo que no se creó (mutante: ignorar res.ok de addWorktree).
test('createWorkspace reports add-failed when the branch is mounted elsewhere', async () => {
  const back = await repo();
  const base = await mkdtemp(join(tmpdir(), 'chalc-ws-base-'));
  // monta feat/dup en un worktree previo: el siguiente add de esa rama DEBE fallar sin --force
  const prev = planWorkspace(base, '004-previa', [{ name: 'back', path: back }]);
  assert.equal((await createWorkspace(prev, 'feat/dup')).ok, true);
  const plan = planWorkspace(base, '005-login', [{ name: 'back', path: back }]);
  const res = await createWorkspace(plan, 'feat/dup');
  assert.equal(res.ok, false);
  assert.deepEqual(res.failures, [{ name: 'back', reason: 'add-failed' }]);
  assert.equal(res.created.length, 0);
});

// R11 — el handoff se escribe en la raíz del workspace.
test('writeHandoff writes handoff.md at the workspace root', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-ws-ho-'));
  const file = await writeHandoff(dir, 'Eres el ORQUESTADOR.');
  assert.equal(file, join(dir, 'handoff.md'));
  assert.match(await readFile(file, 'utf8'), /ORQUESTADOR/);
});

// R8 — recuerda la carpeta base en la config SIN pisar otras claves; recall la devuelve.
test('rememberWorkspaceDir persists and preserves existing config keys', async () => {
  const cfgDir = await mkdtemp(join(tmpdir(), 'chalc-cfg-'));
  const cfgPath = join(cfgDir, 'config.json');
  await mkdir(cfgDir, { recursive: true });
  await writeFile(cfgPath, JSON.stringify({ provider: 'openrouter', apiKey: 'k' }), 'utf8');
  await rememberWorkspaceDir('D:/features', cfgPath);
  const saved = JSON.parse(await readFile(cfgPath, 'utf8'));
  assert.equal(saved.workspaceDir, 'D:/features');
  assert.equal(saved.provider, 'openrouter');
  assert.equal(saved.apiKey, 'k');
  assert.equal(await recallWorkspaceDir(cfgPath), 'D:/features');
});

// R8 — sin config previa: remember crea el archivo; recall sin dato devuelve ''.
test('recallWorkspaceDir returns empty when nothing was saved', async () => {
  const cfgPath = join(await mkdtemp(join(tmpdir(), 'chalc-cfg-')), 'config.json');
  assert.equal(await recallWorkspaceDir(cfgPath), '');
  await rememberWorkspaceDir('/tmp/ws', cfgPath);
  assert.equal(await recallWorkspaceDir(cfgPath), '/tmp/ws');
});
