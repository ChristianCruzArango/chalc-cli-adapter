// T6 (spec 020, R1, R2) — `node .chalc/live.mjs`: levanta el tablero en segundo plano y entrega la URL.
//
// El agente lo corre cuando el usuario pregunta en qué paso va: tiene que volver enseguida con la URL, sin
// quedarse colgado de un servidor (que sigue vivo, desacoplado), y sin abrir un segundo tablero si ya hay uno
// que responde.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { request } from 'node:http';
import { startLive } from '../catalog/live/live.mjs';
import { announce, readAnnouncement } from '../catalog/live/lib/lifecycle.mjs';

const LIVE = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'catalog', 'live', 'live.mjs');
const project = () => mkdtemp(join(tmpdir(), 'chalc-live-start-'));

// ── las decisiones, sin procesos ──────────────────────────────────────────────────────────────

test('R2: a board that is alive and answers is reused, and nothing is launched', async () => {
  const root = await project();
  await announce(root, { url: 'http://127.0.0.1:4100/', pid: 42 });
  let launched = 0;
  const result = await startLive(root, { alive: () => true, responds: async () => true, launch: () => { launched += 1; } });
  assert.deepEqual(result, { url: 'http://127.0.0.1:4100/', reused: true });
  assert.equal(launched, 0);
});

test('R2: a dead or silent board is replaced by a new one', async () => {
  for (const [alive, answers] of [[false, true], [true, false]]) {
    const root = await project();
    await announce(root, { url: 'http://127.0.0.1:4100/', pid: 42 });
    const launch = async () => { await announce(root, { url: 'http://127.0.0.1:4200/', pid: 77 }); return 77; };
    const result = await startLive(root, { alive: () => alive, responds: async () => answers, launch, pollMs: 5 });
    assert.deepEqual(result, { url: 'http://127.0.0.1:4200/', reused: false }, `${alive}/${answers}`);
  }
});

test('R1: without any board, one is launched and its URL returned once it announces itself', async () => {
  const root = await project();
  const launch = async () => { setTimeout(() => announce(root, { url: 'http://127.0.0.1:4300/', pid: 9 }), 30); return 9; };
  assert.deepEqual(await startLive(root, { alive: () => true, responds: async () => true, launch, pollMs: 5 }), { url: 'http://127.0.0.1:4300/', reused: false });
});

test('R1: if the new board never announces itself, it says so instead of waiting forever', async () => {
  const root = await project();
  await assert.rejects(startLive(root, { alive: () => false, responds: async () => false, launch: async () => 5, pollMs: 5, timeoutMs: 60 }), /did not start/);
});

test('R1: an old announcement of another process is not taken for the new board', async () => {
  const root = await project();
  await announce(root, { url: 'http://127.0.0.1:4100/', pid: 42 });
  const launch = async () => { setTimeout(() => announce(root, { url: 'http://127.0.0.1:4500/', pid: 8 }), 30); return 8; };
  const result = await startLive(root, { alive: () => false, responds: async () => false, launch, pollMs: 5 });
  assert.equal(result.url, 'http://127.0.0.1:4500/');
});

// ── de verdad, con procesos ───────────────────────────────────────────────────────────────────

const get = (url) => new Promise((done) => {
  const req = request(url, (res) => { res.resume(); res.on('end', () => done(res.statusCode)); });
  req.on('error', () => done(0));
  req.end();
});
const run = (root, args = []) => spawnSync(process.execPath, [LIVE, ...args], { cwd: root, encoding: 'utf8', timeout: 20000, env: { ...process.env, CLAUDE_PROJECT_DIR: '' } });

test('R1, R2: it prints only the URL, the board answers, and a second call reuses it', async () => {
  const root = await project();
  await mkdir(join(root, 'specs', '001-x'), { recursive: true });
  await writeFile(join(root, 'specs', '001-x', 'tasks.md'), '- [ ] **T1** (R1) — Algo\n');
  const first = run(root);
  try {
    assert.equal(first.status, 0, first.stderr);
    const url = first.stdout.trim();
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    assert.equal(await get(`${url}state.json`), 200);
    const second = run(root);
    assert.equal(second.stdout.trim(), url);
  } finally {
    const live = await readAnnouncement(root);
    if (live) process.kill(live.pid);
  }
});

// Encontrado en la CI de Windows: para saber si el tablero vive se pedía `/state.json`, que arma el estado del repo
// (git incluido) y en un runner lento pasaba del límite: el tablero vivo se daba por muerto y se lanzaba otro. Se
// pregunta a la página, que no calcula nada.
test('R2: checking that a board answers asks the page, never waits for the repo state', async () => {
  const { createServer } = await import('node:http');
  const { RESPONDS_TIMEOUT_MS, responds } = await import('../catalog/live/live.mjs');
  const server = createServer((req, res) => {
    if (req.url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html>'); return; }
    setTimeout(() => { res.writeHead(200); res.end('{}'); }, 60_000);   // el estado, lento a propósito
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  try {
    assert.equal(await responds(`http://127.0.0.1:${server.address().port}/`), true);
    assert.ok(RESPONDS_TIMEOUT_MS >= 3000);
  } finally { server.closeAllConnections(); server.close(); }
});

test('R2: a board that answers anything but 200 on its page, or nothing at all, does not count', async () => {
  const { createServer } = await import('node:http');
  const { responds } = await import('../catalog/live/live.mjs');
  const server = createServer((req, res) => { res.writeHead(500); res.end(); });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;
  try { assert.equal(await responds(`http://127.0.0.1:${port}/`), false); } finally { server.close(); }
  await new Promise((done) => server.on('close', done));
  assert.equal(await responds(`http://127.0.0.1:${port}/`), false);
});

test('R2: a board that accepts the connection but never answers is given up on, within the time limit', async () => {
  const { createServer } = await import('node:http');
  const { responds } = await import('../catalog/live/live.mjs');
  const server = createServer(() => {});   // acepta y no contesta nunca
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  try {
    const started = Date.now();
    assert.equal(await responds(`http://127.0.0.1:${server.address().port}/`, 80), false);
    assert.ok(Date.now() - started < 2000, 'it does not wait for the default limit');
  } finally { server.closeAllConnections(); server.close(); }
});
