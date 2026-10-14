// T10 (spec 022, R19, C4/C5/C6) — mutantes del tablero: la recuperación sin carrera del candado entre hooks,
// la cola acotada del transcript, el anuncio que solo acepta `127.0.0.1` y el 500 de una petición que falla
// a medias.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, utimes, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { LOCK_REL, reclaim, withLock } from '../catalog/live/lib/lock.mjs';
import { readNew } from '../catalog/live/lib/transcript.mjs';
import { LIVE_REL, readAnnouncement } from '../catalog/live/lib/lifecycle.mjs';
import { createLiveServer } from '../catalog/live/server.mjs';

// Una carpeta de candado, envejecida `age` ms si se pide.
async function lockDir(path, age = 0) {
  await mkdir(path, { recursive: true });
  if (age) {
    const when = new Date(Date.now() - age);
    await utimes(path, when, when);
  }
}

// ── candado ───────────────────────────────────────────────────────────────────────────────────

// T10 (spec 022, R19, C5)
test('C5: reclaim removes a stale lock and leaves no reclaim guard behind', async (t) => {
  const path = join(await tempDir(t, 'chalc-mut-lock-'), 'usage.lock');
  await lockDir(path, 60_000);
  await reclaim(path);
  assert.equal(existsSync(path), false);
  assert.equal(existsSync(`${path}.reclaim`), false);
});

// T10 (spec 022, R19, C5)
test('C5: reclaim looks again and keeps a lock that is fresh by then', async (t) => {
  const path = join(await tempDir(t, 'chalc-mut-lock-'), 'usage.lock');
  await lockDir(path);
  await reclaim(path);
  assert.equal(existsSync(path), true);
  assert.equal(existsSync(`${path}.reclaim`), false);
});

// T10 (spec 022, R19, C5)
test('C5: while another hook holds a fresh reclaim guard, nothing is removed', async (t) => {
  const path = join(await tempDir(t, 'chalc-mut-lock-'), 'usage.lock');
  await lockDir(path, 60_000);
  await lockDir(`${path}.reclaim`);
  await reclaim(path);
  assert.equal(existsSync(path), true);
  assert.equal(existsSync(`${path}.reclaim`), true);
});

// T10 (spec 022, R19, C5)
test('C5: a reclaim guard left by a dead hook expires, and the work then runs', async (t) => {
  const root = await tempDir(t, 'chalc-mut-lock-');
  const path = join(root, LOCK_REL);
  await lockDir(path, 60_000);
  await lockDir(`${path}.reclaim`, 60_000);
  assert.equal(await withLock(root, async () => 'hecho', { tries: 3, waitMs: 1 }), 'hecho');
  assert.equal(existsSync(path), false);
  assert.equal(existsSync(`${path}.reclaim`), false);
});

// ── transcript ────────────────────────────────────────────────────────────────────────────────

async function transcript(t, text) {
  const path = join(await tempDir(t, 'chalc-mut-tr-'), 't.jsonl');
  await writeFile(path, text);
  return path;
}

// T10 (spec 022, R19, C6)
test('C6: exactly maxBytes of new text is read whole, first line included', async (t) => {
  const path = await transcript(t, 'a\nb\n');
  assert.deepEqual(await readNew(path, 0, { maxBytes: 4 }), { text: 'a\nb\n', offset: 4 });
});

// T10 (spec 022, R19, C6)
test('C6: what is new since the cursor fits, so nothing before the cursor is re-read', async (t) => {
  const path = await transcript(t, 'aa\nbb\ncc\n');
  assert.deepEqual(await readNew(path, 6, { maxBytes: 8 }), { text: 'cc\n', offset: 9 });
});

// T10 (spec 022, R19, C6)
test('C6: a tail that starts right at a line break keeps the next whole line', async (t) => {
  const path = await transcript(t, 'aaaa\nbb\n');
  assert.deepEqual(await readNew(path, 0, { maxBytes: 4 }), { text: 'bb\n', offset: 8 });
});

// T10 (spec 022, R19, C6)
test('C6: a tail with no whole line reads nothing and leaves the cursor where it was', async (t) => {
  const path = await transcript(t, 'abcdef');
  assert.deepEqual(await readNew(path, 0, { maxBytes: 3 }), { text: '', offset: 0 });
});

// ── anuncio ───────────────────────────────────────────────────────────────────────────────────

async function announced(t, content) {
  const root = await tempDir(t, 'chalc-mut-ann-');
  await mkdir(join(root, '.chalc'), { recursive: true });
  await writeFile(join(root, LIVE_REL), content);
  return readAnnouncement(root);
}

// T10 (spec 022, R19, C4)
test('C4: only a URL that STARTS with http://127.0.0.1 is announced', async (t) => {
  assert.equal(await announced(t, JSON.stringify({ url: 'https://evil.example/?http://127.0.0.1:80/', pid: 1 })), null);
  assert.equal(await announced(t, JSON.stringify({ url: 'xhttp://127.0.0.1:80/', pid: 1 })), null);
  assert.deepEqual(await announced(t, JSON.stringify({ url: 'http://127.0.0.1:80/', pid: 1, started: 's' })), { url: 'http://127.0.0.1:80/', pid: 1, started: 's' });
});

// T10 (spec 022, R19, C4)
test('C4: an announcement that is JSON null reads as none instead of throwing', async (t) => {
  assert.equal(await announced(t, 'null'), null);
});

// ── servidor ──────────────────────────────────────────────────────────────────────────────────

function get(url) {
  return new Promise((resolve, reject) => {
    const req = request(url, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], body }));
    });
    req.setTimeout(3000, () => req.destroy(new Error('sin respuesta')));
    req.on('error', reject);
    req.end();
  });
}

async function serving(t, page) {
  const live = await createLiveServer({ root: '/x', idleMs: 60_000, state: async () => ({ lang: 'en' }), page, makeIdle: () => ({ touch() {}, stop() {} }) });
  t.after(() => live.close());
  return live;
}

// T10 (spec 022, R19)
test('a page that cannot be built answers a plain-text 500', async (t) => {
  const live = await serving(t, () => { throw new Error('rota'); });
  const res = await get(live.url);
  assert.equal(res.status, 500);
  assert.equal(res.body, 'page unavailable');
  assert.match(res.type, /^text\/plain/);
});

// T10 (spec 022, R19)
test('a response that fails after its headers went out is closed, not left hanging', async (t) => {
  const live = await serving(t, () => 42);
  const res = await get(live.url);
  assert.equal(res.status, 200);
  assert.equal(res.body, '');
});

// T10 (spec 022, R19, C4)
test('C4: a URL that is not a string is refused even if it would stringify to a local one', async (t) => {
  assert.equal(await announced(t, JSON.stringify({ url: ['http://127.0.0.1:80/'], pid: 1 })), null);
});
