// T10 (spec 022, R19, S6) — mutantes del buzón: un lado es un NOMBRE (nunca una ruta ni otra cosa que un
// string), la validación del destinatario precede a todo, la lista de lados válidos no enseña los inválidos,
// y `markRead` no sale de su carpeta.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { isSideId, markRead, send } from '../catalog/mail/lib/mailbox.mjs';
import { textOf } from '../catalog/mail/lib/text.mjs';

// T10 (spec 022, R19, S6)
test('S6: a side id must be a string, even one that would stringify to a valid name', () => {
  assert.equal(isSideId(['front']), false);
  assert.equal(isSideId({ toString: () => 'front' }), false);
  assert.equal(isSideId('front'), true);
});

// T10 (spec 022, R19, S6)
test('S6: a recipient that is a path is rejected as a bad side name, even if a peer claims it', async (t) => {
  const dir = await tempDir(t, 'chalc-mut-mail-');
  for (const lang of ['es', 'en']) {
    const result = await send({ dir, from: 'back', to: '../x', message: 'hola', peers: [{ id: '../x' }], now: 'n', lang });
    assert.deepEqual(result, { ok: false, error: textOf(lang).badSide('../x'), path: '' });
    assert.match(result.error, /"\.\.\/x"/);
  }
});

// T10 (spec 022, R19, S6)
test('S6: an unknown side lists only the valid peers', async (t) => {
  const dir = await tempDir(t, 'chalc-mut-mail-');
  const result = await send({ dir, from: 'back', to: 'otro', message: 'hola', peers: [{ id: 'front' }, { id: '../evil' }], now: 'n' });
  assert.equal(result.error, textOf('en').unknownSide('otro', 'front'));
});

// T10 (spec 022, R19, S6)
test('S6: markRead refuses a side that is a path and moves nothing outside the mailbox', async (t) => {
  const root = await tempDir(t, 'chalc-mut-mail-');
  const outside = join(root, 'fuera', 'new');
  await mkdir(outside, { recursive: true });
  await writeFile(join(outside, 'nota.md'), 'x');
  assert.equal(await markRead(join(root, 'mail'), '../fuera'), 0);
  assert.ok(existsSync(join(outside, 'nota.md')));
});
