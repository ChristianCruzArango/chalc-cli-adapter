// T7 (spec 022, R14, R17, R18) — cierre de auditoría del tablero en vivo: el anuncio que se acepta, el
// proceso que se da por vivo, el servidor que no muere, el candado sin carrera, el transcript que no se
// lee entero y la redacción de las banderas de contraseña.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readdir, utimes, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { request } from 'node:http';
import { tempDir } from './helpers/tmpdir.mjs';
import { LIVE_REL, isAlive, readAnnouncement } from '../catalog/live/lib/lifecycle.mjs';
import { createLiveServer } from '../catalog/live/server.mjs';
import { LOCK_REL, withLock } from '../catalog/live/lib/lock.mjs';
import { readNew } from '../catalog/live/lib/transcript.mjs';
import { activityOf } from '../catalog/live/lib/activity.mjs';

const announced = async (t, url) => {
  const root = await tempDir(t, 'chalc-g7-live-');
  await mkdir(join(root, '.chalc'), { recursive: true });
  await writeFile(join(root, LIVE_REL), JSON.stringify({ url, pid: 7 }));
  return readAnnouncement(root);
};

// T7 (spec 022, R14, S7a)
test('S7a: an announcement is only accepted for http://127.0.0.1:<port>/', async (t) => {
  assert.equal((await announced(t, 'http://127.0.0.1:4100/')).url, 'http://127.0.0.1:4100/');
  for (const url of ['https://evil.example/', 'http://127.0.0.1:4100/x', 'http://localhost:4100/', 'http://127.0.0.1/', 'u', 'javascript:alert(1)', 'http://127.0.0.1:4100/\n']) {
    assert.equal(await announced(t, url), null, url);
  }
});

// T7 (spec 022, R14, S7a)
test('S7a: a process that refuses the signal (EPERM) belongs to someone else, so it is not our board', () => {
  assert.equal(isAlive(1, () => { throw Object.assign(new Error('x'), { code: 'EPERM' }); }), false);
  assert.equal(isAlive(process.pid), true);
});

const get = (url) => new Promise((done, fail) => {
  const req = request(url, (res) => { res.resume(); res.on('end', () => done(res.statusCode)); });
  req.on('error', fail);
  req.end();
});

// T7 (spec 022, R18, F17)
test('F17: a page that fails to render answers 500 and the server keeps serving', async () => {
  const VIEW = { lang: 'es' };
  const live = await createLiveServer({ root: '/x', idleMs: 60_000, state: async () => VIEW, page: () => { throw new Error('roto'); } });
  try {
    assert.equal(await get(live.url), 500);
    assert.equal(await get(`${live.url}state.json`), 200);
  } finally { await live.close(); }
});

// T7 (spec 022, R18, F19)
test('F19: two hooks that find the same stale lock never work at the same time', async (t) => {
  const root = await tempDir(t, 'chalc-g7-lock-');
  for (let round = 0; round < 15; round += 1) {
    await mkdir(join(root, LOCK_REL), { recursive: true });
    const old = new Date(Date.now() - 60_000);
    await utimes(join(root, LOCK_REL), old, old);
    let inside = 0;
    let most = 0;
    const work = async () => {
      inside += 1; most = Math.max(most, inside);
      await new Promise((done) => setTimeout(done, 15));
      inside -= 1;
    };
    await Promise.all([withLock(root, work), withLock(root, work), withLock(root, work)]);
    assert.equal(most, 1, `ronda ${round}`);
  }
  // Lo que se apartó al recuperar el candado viejo no se queda en la carpeta.
  assert.deepEqual((await readdir(join(root, '.chalc'))).filter((n) => n.startsWith('usage.lock')), []);
  assert.ok(!existsSync(join(root, LOCK_REL)));
});

// T7 (spec 022, R18, F20)
test('F20: a first look at a huge transcript reads only its tail, from a line start', async (t) => {
  const dir = await tempDir(t, 'chalc-g7-tail-');
  const path = join(dir, 't.jsonl');
  await writeFile(path, `${'x'.repeat(100)}\n${'y'.repeat(100)}\nfin\n`);
  const size = 100 + 1 + 100 + 1 + 4;
  assert.deepEqual(await readNew(path, 0, { maxBytes: 50 }), { text: 'fin\n', offset: size });
  assert.deepEqual(await readNew(path, undefined, { maxBytes: 120 }), { text: `${'y'.repeat(100)}\nfin\n`, offset: size });
  // Sin pasar del tope se lee como siempre.
  assert.deepEqual(await readNew(path, 202, { maxBytes: 50 }), { text: 'fin\n', offset: size });
});

// T7 (spec 022, R17, S9)
test('S9: password and token flags of a command never reach the activity log', () => {
  const summary = (command) => activityOf({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } }).summary;
  for (const [command, secret] of [
    ['mysql -u root -pSecreto db', 'Secreto'],
    ['curl -u ana:clave https://x.example', 'clave'],
    ['deploy --password hunter2', 'hunter2'],
    ['deploy --token abc123', 'abc123'],
    ['psql --password=hunter3', 'hunter3']
  ]) {
    assert.doesNotMatch(summary(command), new RegExp(secret), command);
  }
  // Lo que no es una contraseña se queda.
  for (const command of ['find . -print', 'npm run -p build', 'git log -u --token-count']) assert.equal(summary(command), command);
});
