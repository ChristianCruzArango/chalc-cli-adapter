// T4 (spec 020, R1, R2, R3) — el servidor del tablero y su ciclo de vida.
//
// Solo lectura y solo local: GET en `127.0.0.1`, y además se comprueba la cabecera `Host` —sin eso, una
// página cualquiera podría leer el tablero con un DNS rebinding—. Cabeceras defensivas (CSP que solo deja
// el script y el estilo propios, `nosniff`, sin caché). Se anuncia en `.chalc/live.json` para que una
// segunda llamada reutilice el que ya corre, y se apaga solo cuando nadie lo mira.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { request } from 'node:http';
import { LIVE_REL, announce, idleTimer, isAlive, readAnnouncement, retire } from '../catalog/live/lib/lifecycle.mjs';
import { buildState, createLiveServer, IDLE_MS, langOf } from '../catalog/live/server.mjs';

const project = () => mkdtemp(join(tmpdir(), 'chalc-live-server-'));

// ── ciclo de vida ─────────────────────────────────────────────────────────────────────────────

test('R2: the board announces itself in .chalc/live.json, and is read back', async () => {
  const root = await project();
  assert.equal(await readAnnouncement(root), null);
  await announce(root, { url: 'http://127.0.0.1:4100/', pid: 123 });
  assert.equal(LIVE_REL, '.chalc/live.json');
  const read = await readAnnouncement(root);
  assert.deepEqual({ url: read.url, pid: read.pid }, { url: 'http://127.0.0.1:4100/', pid: 123 });
  assert.match(read.started, /^\d{4}-\d{2}-\d{2}T/);
});

test('R2: a broken announcement reads as none', async () => {
  const root = await project();
  await mkdir(join(root, '.chalc'), { recursive: true });
  for (const text of ['{ roto', '[]', '{"url":5,"pid":"x"}']) {
    await writeFile(join(root, LIVE_REL), text);
    assert.equal(await readAnnouncement(root), null, text);
  }
});

test('R3: a board only withdraws its own announcement', async () => {
  const root = await project();
  await announce(root, { url: 'http://127.0.0.1:4100/', pid: 1 });
  await retire(root, 2);
  assert.ok(existsSync(join(root, LIVE_REL)));
  await retire(root, 1);
  assert.ok(!existsSync(join(root, LIVE_REL)));
  await retire(root, 1);
});

// Spec 022 (S7a): un `EPERM` es un proceso de otro usuario, así que no es el tablero que lanzamos.
test('R2: a process is alive if signal 0 reaches it, dead if it does not exist or is someone else\'s', () => {
  assert.equal(isAlive(process.pid), true);
  assert.equal(isAlive(1, () => { throw Object.assign(new Error('x'), { code: 'EPERM' }); }), false);
  assert.equal(isAlive(999999, () => { throw Object.assign(new Error('x'), { code: 'ESRCH' }); }), false);
  assert.equal(isAlive(0), false);
  assert.equal(isAlive(undefined), false);
});

test('R3: the idle timer fires after the quiet time, and every touch starts it again', () => {
  const timers = [];
  const setT = (fn, ms) => { timers.push({ fn, ms, cleared: false }); return timers.length - 1; };
  const clearT = (id) => { timers[id].cleared = true; };
  let fired = 0;
  const idle = idleTimer(1000, () => { fired += 1; }, { setT, clearT });
  idle.touch();
  assert.deepEqual(timers.map((t) => [t.ms, t.cleared]), [[1000, true], [1000, false]]);
  timers.at(-1).fn();
  assert.equal(fired, 1);
  idle.stop();
  assert.equal(timers.at(-1).cleared, true);
});

// ── el servidor ───────────────────────────────────────────────────────────────────────────────

function get(url, { method = 'GET', host } = {}) {
  return new Promise((done, fail) => {
    const u = new URL(url);
    const req = request({ host: u.hostname, port: u.port, path: u.pathname, method, headers: host ? { host } : {} }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => done({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', fail);
    req.end();
  });
}

const VIEW = { lang: 'es', feature: 'specs/001', progress: { done: 1, total: 2 }, tasks: [], next: { action: 'work_task', role: '', reason: '' }, gate: { verdict: 'none', date: '', stages: [] }, roles: [], missing: { tasks: [], roles: [], next: 'work_task' }, activity: [] };

test('R1: the board serves its page and its state on 127.0.0.1 only, read-only', async () => {
  const live = await createLiveServer({ root: '/x', idleMs: 60_000, state: async () => VIEW, lang: async () => 'es' });
  try {
    assert.match(live.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    const page = await get(live.url);
    assert.equal(page.status, 200);
    assert.match(page.headers['content-type'], /^text\/html/);
    assert.match(page.body, /<html lang="es">/);
    const state = await get(`${live.url}state.json`);
    assert.match(state.headers['content-type'], /^application\/json/);
    assert.deepEqual(JSON.parse(state.body), VIEW);
    assert.equal((await get(`${live.url}otra`)).status, 404);
    assert.equal((await get(live.url, { method: 'POST' })).status, 405);
    assert.equal((await get(live.url, { method: 'DELETE' })).status, 405);
  } finally { await live.close(); }
});

test('R1: it refuses another Host (DNS rebinding) and sends defensive headers', async () => {
  const live = await createLiveServer({ root: '/x', idleMs: 60_000, state: async () => VIEW });
  try {
    assert.equal((await get(live.url, { host: 'malo.example:80' })).status, 403);
    assert.equal((await get(live.url, { host: `localhost:${new URL(live.url).port}` })).status, 200);
    const { headers } = await get(live.url);
    assert.match(headers['content-security-policy'], /default-src 'none'/);
    assert.match(headers['content-security-policy'], /connect-src 'self'/);
    assert.equal(headers['x-content-type-options'], 'nosniff');
    assert.equal(headers['cache-control'], 'no-store');
  } finally { await live.close(); }
});

test('R1: if the state cannot be built, it answers 500 instead of crashing', async () => {
  const live = await createLiveServer({ root: '/x', idleMs: 60_000, state: async () => { throw new Error('roto'); } });
  try {
    const broken = await get(`${live.url}state.json`);
    assert.deepEqual([broken.status, broken.body], [500, 'state unavailable']);
    assert.match(broken.headers['content-type'], /^text\/plain; charset=utf-8/);
    assert.equal((await get(live.url)).status, 200, 'R2b: la página no depende del estado');
  } finally { await live.close(); }
});

// R2b: `live.mjs` pregunta a la página si el tablero vive. Si la página armara el estado (git incluido), en una
// máquina lenta (Windows) pasaría del plazo, el tablero se daría por muerto y se levantaría otro en cada llamada.
test('R2b: the page never builds the repo state; only /state.json does', async () => {
  let built = 0;
  const live = await createLiveServer({ root: '/x', idleMs: 60_000, state: async () => { built += 1; return VIEW; }, lang: async () => 'es' });
  try {
    const page = await get(live.url);
    assert.deepEqual([page.status, built], [200, 0]);
    assert.match(page.body, /<html lang="es">/);
    await get(`${live.url}state.json`);
    assert.equal(built, 1);
  } finally { await live.close(); }
});

test('R2b/R7: the page language is gate.json, then .chalc.json, then English', async () => {
  const root = await project();
  await mkdir(join(root, '.chalc'), { recursive: true });
  await writeFile(join(root, '.chalc', 'gate.json'), JSON.stringify({ language: '' }));
  assert.equal(await langOf(root), 'en');
  await writeFile(join(root, '.chalc.json'), JSON.stringify({ lang: 'es' }));
  assert.equal(await langOf(root), 'es');
  await writeFile(join(root, '.chalc', 'gate.json'), JSON.stringify({ language: 'en' }));
  assert.equal(await langOf(root), 'en');
});

test('R3: with nobody looking, it calls its idle handler', async () => {
  let idle;
  const fired = new Promise((done) => { idle = done; });
  const live = await createLiveServer({ root: '/x', idleMs: 40, state: async () => VIEW, onIdle: () => idle('idle') });
  assert.equal(await fired, 'idle');
  await live.close();
});

test('R5: the state of a real repo is the advisor\'s view, even with nothing equipped', async () => {
  const root = await project();
  const view = await buildState(root);
  assert.equal(typeof view.next.action, 'string');
  assert.deepEqual(view.activity, []);
  assert.deepEqual(view.gate, { verdict: 'none', verdictText: '', date: '', stages: [] });
});

test('R6: the state includes what the activity hook recorded', async () => {
  const root = await project();
  await mkdir(join(root, '.chalc'), { recursive: true });
  await writeFile(join(root, '.chalc', 'activity.jsonl'), JSON.stringify({ at: '2026-10-13T20:00:00.000Z', who: 'revisor', kind: 'start' }) + '\n');
  await writeFile(join(root, '.chalc', 'gate.state.json'), JSON.stringify({ date: '2026-10-13T20:00:00.000Z', verdict: 'pass', stages: [{ stage: 'tests', ok: true }] }));
  const view = await buildState(root);
  assert.deepEqual(view.activity.map((a) => a.who), ['revisor']);
  assert.equal(view.gate.verdict, 'pass');
  assert.ok((await readFile(join(root, '.chalc', 'activity.jsonl'), 'utf8')).length > 0);
});

// Los casos de abajo salen de la pasada de mutación.

test('R2: each part of a broken announcement is checked on its own', async () => {
  const root = await project();
  await mkdir(join(root, '.chalc'), { recursive: true });
  const url = 'http://127.0.0.1:4100/';
  for (const text of ['null', '{"url":5,"pid":1}', `{"url":"${url}","pid":"1"}`, `{"url":"${url}","pid":1.5}`, '{"url":"u","pid":7}']) {
    await writeFile(join(root, LIVE_REL), text);
    assert.equal(await readAnnouncement(root), null, text);
  }
  await writeFile(join(root, LIVE_REL), `{"url":"${url}","pid":7}`);
  assert.deepEqual(await readAnnouncement(root), { url, pid: 7, started: '' });
});

test('R3: the board waits 15 minutes by default', () => {
  assert.equal(IDLE_MS, 15 * 60 * 1000);
});

test('R3: every request starts the quiet time again', async () => {
  let touches = 0;
  const makeIdle = () => ({ touch: () => { touches += 1; }, stop: () => {} });
  const live = await createLiveServer({ root: '/x', state: async () => VIEW, makeIdle });
  try {
    await get(live.url);
    await get(`${live.url}state.json`);
    assert.equal(touches, 2);
  } finally { await live.close(); }
});

test('R1: HEAD is read-only too; refusals say why, as plain text', async () => {
  const live = await createLiveServer({ root: '/x', idleMs: 60_000, state: async () => VIEW });
  try {
    assert.equal((await get(live.url, { method: 'HEAD' })).status, 200);
    for (const [args, status, body] of [[[live.url, { method: 'POST' }], 405, 'read-only'], [[live.url, { host: 'malo:1' }], 403, 'forbidden'], [[`${live.url}x`], 404, 'not found']]) {
      const r = await get(...args);
      assert.deepEqual([r.status, r.body], [status, body]);
      assert.match(r.headers['content-type'], /^text\/plain; charset=utf-8/);
    }
    assert.match((await get(`${live.url}state.json`)).headers['content-type'], /^application\/json; charset=utf-8/);
  } finally { await live.close(); }
});

test('R5: the state of a repo with a spec lists its tasks', async () => {
  const root = await project();
  await mkdir(join(root, 'specs', '001-x'), { recursive: true });
  await writeFile(join(root, 'specs', '001-x', 'tasks.md'), '- [ ] **T1** (R1) — Algo\n');
  const view = await buildState(root);
  assert.deepEqual(view.tasks.map((t) => [t.text, t.current]), [['T1 (R1) — Algo', true]]);
});

test('R12: the state includes the tokens and time the hook counted', async () => {
  const root = await project();
  await mkdir(join(root, 'specs', '001-x'), { recursive: true });
  await writeFile(join(root, 'specs', '001-x', 'tasks.md'), '- [ ] **T1** (R1) — Algo\n');
  await mkdir(join(root, '.chalc'), { recursive: true });
  await writeFile(join(root, '.chalc', 'usage.json'), JSON.stringify({ cursors: {}, tasks: { T1: { input: 4, output: 6, cacheRead: 0, cacheWrite: 0, firstAt: '2026-10-13T10:00:00.000Z', lastAt: '2026-10-13T10:01:00.000Z' } } }));
  const view = await buildState(root);
  assert.deepEqual([view.tasks[0].tokens.total, view.tasks[0].ms, view.totals.tokens.total], [10, 60_000, 10]);
});
