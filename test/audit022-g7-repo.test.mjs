// T7 (spec 022, R14, R17) — lo que el tooling emitido deja en el repo: los artefactos locales de `.chalc/`
// quedan fuera de git también en repos que ya existían, y el buzón no escribe fuera de su carpeta.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { LOCAL_IGNORES, ensureLocalIgnores } from '../lib/gitignore-local.mjs';
import { emitRepoTools } from '../lib/commands/equip.mjs';
import { markRead, send } from '../catalog/mail/lib/mailbox.mjs';

const lines = async (dir) => (await readFile(join(dir, '.gitignore'), 'utf8')).split(/\r?\n/);

// T7 (spec 022, R14, S7a)
test('S7a: the local artifacts of .chalc are the five the audit names', () => {
  assert.deepEqual([...LOCAL_IGNORES].sort(), ['.chalc/activity.jsonl', '.chalc/live.json', '.chalc/memory/state.json', '.chalc/usage.json', '.chalc/usage.lock/']);
});

// T7 (spec 022, R14, S7a)
test('S7a: an existing .gitignore gets only the missing entries, once, and keeps what it had', async (t) => {
  const dir = await tempDir(t, 'chalc-g7-ignore-');
  await writeFile(join(dir, '.gitignore'), 'node_modules/\n.chalc/live.json');
  assert.equal(await ensureLocalIgnores(dir), true);
  const after = await lines(dir);
  assert.ok(after.includes('node_modules/'));
  for (const entry of LOCAL_IGNORES) assert.equal(after.filter((l) => l === entry).length, 1, entry);
  const text = await readFile(join(dir, '.gitignore'), 'utf8');
  assert.equal(await ensureLocalIgnores(dir), false, 'idempotente');
  assert.equal(await readFile(join(dir, '.gitignore'), 'utf8'), text);
});

// T7 (spec 022, R14, S7a)
test('S7a: a repo that already ignores the whole .chalc folder is left alone; one without .gitignore gets one', async (t) => {
  const ignored = await tempDir(t, 'chalc-g7-ignore-');
  await writeFile(join(ignored, '.gitignore'), '.chalc/\n');
  assert.equal(await ensureLocalIgnores(ignored), false);
  const bare = await tempDir(t, 'chalc-g7-ignore-');
  assert.equal(await ensureLocalIgnores(bare), true);
  for (const entry of LOCAL_IGNORES) assert.ok((await lines(bare)).includes(entry), entry);
});

// T7 (spec 022, R14, S7a)
test('S7a: equipping an existing repo adds the local artifacts to its .gitignore', async (t) => {
  const dir = await tempDir(t, 'chalc-g7-equip-');
  await writeFile(join(dir, '.gitignore'), 'dist/\n');
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts: { test: 'node --test' } }));
  await emitRepoTools(dir);
  for (const entry of LOCAL_IGNORES) assert.ok((await lines(dir)).includes(entry), entry);
});

// T7 (spec 022, R17, S9)
test('S9: a side id with a path in it never leaves the mailbox folder', async (t) => {
  const root = await tempDir(t, 'chalc-g7-mail-');
  const dir = join(root, 'mail');
  const peers = [{ id: 'front' }, { id: '../fuera' }];
  for (const over of [{ from: '../../fuera' }, { from: 'back/x' }, { to: '../fuera' }, { from: 'Back' }]) {
    const result = await send({ dir, from: 'back', to: 'front', message: 'hola', peers, now: '2026-10-14T10:00:00Z', ...over });
    assert.equal(result.ok, false, JSON.stringify(over));
    assert.match(result.error, /lado|side/i);
  }
  assert.ok(!existsSync(join(root, 'fuera')));
  assert.equal(await markRead(dir, '../fuera'), 0);
  assert.deepEqual(await readdir(root), []);
});
