// `chalc feature` de punta a punta, con un proveedor de IA falso: los dos modos (repos tal cual y
// workspaces con worktrees) escriben la spec, el contrato y su lock en cada lado, y el hand-off
// apunta a carpetas que existen.
//
// Regresión: en modo worktree, si la rama base ya traía una spec con el mismo slug, writeSideSpec
// la reutilizaba (001-x) mientras el hand-off apuntaba al número del workspace (002-x).

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../bin/chalc.mjs', import.meta.url));
const CONTRACT = '# Contrato API\n\n## POST /orders\nRequest: { "item": "string" }\nResponse 201: { "id": "string" }\n';
const SPEC = '===FEATURE===\npedidos\n===SPEC===\n# Spec pedidos\n\nConceptos: pedido\n\n- **R1**: WHEN the user creates an order THE SYSTEM SHALL return its id.\n===PLAN===\n# Plan\n===TASKS===\n- [ ] T1 (R1) crear endpoint\n';

function fakeAi() {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const user = (JSON.parse(body || '{}').messages || []).map((m) => m.content).join('\n');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: /Genera el contrato/.test(user) ? CONTRACT : SPEC } }] }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function repo(dir, dep) {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'x', dependencies: { [dep]: '1' } }));
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  git('add', '.'); git('commit', '-qm', 'init');
  return git;
}

function chalc(args, env) {
  return new Promise((resolve) => {
    execFile(process.execPath, [BIN, ...args], { env: { ...process.env, ...env }, timeout: 120000 }, (error, stdout, stderr) => {
      resolve({ code: error ? error.code : 0, out: stdout + stderr });
    });
  });
}

const server = await fakeAi();
test.after(() => server.close());
const root = await mkdtemp(join(tmpdir(), 'chalc-feature-'));
const home = join(root, 'home');
const env = {
  HOME: home, USERPROFILE: home, CHALC_HOME: join(home, '.chalc'), CHALC_LANG: 'en',
  CHALC_PROVIDER: 'ollama', CHALC_MODEL: 'fake', CHALC_BASE_URL: `http://127.0.0.1:${server.address().port}/v1`
};
const front = join(root, 'front');
const back = join(root, 'back');
const gitFront = await repo(front, 'react');
const gitBack = await repo(back, 'express');
await writeFile(join(root, 'hu.md'), '# HU\nComo cliente quiero crear pedidos.\n');

test('repo mode: spec, contract and lock land in both repos, on the same feature branch', async () => {
  const r = await chalc([ 'feature', front, '--back', back, '--doc', join(root, 'hu.md'), '--lang', 'en', '--branch'], env);
  assert.equal(r.code, 0, r.out);
  for (const side of [front, back]) {
    const dir = join(side, 'specs', '001-pedidos');
    for (const f of ['spec.md', 'plan.md', 'tasks.md', 'contracts/api.md', '.chalc/contract.lock.json']) assert.ok(existsSync(join(dir, f)), `${side}: ${f}`);
    assert.equal(await readFile(join(dir, 'contracts', 'api.md'), 'utf8'), CONTRACT);
    assert.equal(execFileSync('git', ['branch', '--show-current'], { cwd: side, encoding: 'utf8' }).trim(), 'feat/pedidos');
  }
  // La spec nueva viene solo de la plantilla: no hay nada del usuario que respaldar.
  assert.doesNotMatch(r.out, /previous copy/);
});

test('worktree mode: the hand-off points at the spec folder that really exists', async () => {
  // La spec del modo anterior queda en la rama base: el slug ya tiene carpeta (001-pedidos).
  for (const git of [gitFront, gitBack]) { git('checkout', '-q', '-b', 'base'); git('add', '-A'); git('commit', '-qm', 'specs'); git('branch', '-D', 'feat/pedidos'); }
  const r = await chalc(['feature', front, '--back', back, '--doc', join(root, 'hu.md'), '--lang', 'en', '--worktree', '--workspace-dir', join(root, 'ws'), '--no-terminals'], env);
  assert.equal(r.code, 0, r.out);
  const wsRoot = join(root, 'ws', 'chalc-workspaces');
  const [ws] = (await readdir(wsRoot)).filter((n) => /^\d{3}-/.test(n));
  const handoff = await readFile(join(wsRoot, ws, 'handoff.md'), 'utf8');
  const refs = [...new Set(handoff.match(/(?:back|front)\/specs\/[\w-]+/g))];
  assert.ok(refs.length >= 2, handoff);
  for (const ref of refs) assert.ok(existsSync(join(wsRoot, ws, ref, 'spec.md')), `the hand-off points at ${ref}, which does not exist`);
});
