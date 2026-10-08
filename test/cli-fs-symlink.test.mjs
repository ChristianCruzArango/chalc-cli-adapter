// S-02 — las herramientas de escritura no salen de la raíz siguiendo enlaces simbólicos.
//
// Dos variantes reproducidas en la auditoría: un enlace interno hacia un archivo EXTERNO que todavía
// no existe (realpath falla y antes se confundía con "no existe"), y un archivo interno que se
// sustituye por un enlace mientras se espera la aprobación.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFsTools, resolveInRoot } from '../cli/tools/fs.mjs';

const POSIX = process.platform !== 'win32';

async function sandbox() {
  const root = await mkdtemp(join(tmpdir(), 'chalc-s02-root-'));
  const outside = await mkdtemp(join(tmpdir(), 'chalc-s02-out-'));
  return { root, outside };
}

test('a link to an outside file that does not exist yet is rejected, not written', { skip: !POSIX }, async () => {
  const { root, outside } = await sandbox();
  await symlink(join(outside, 'evil.plist'), join(root, 'x'));

  assert.throws(() => resolveInRoot(root, 'x'), /symlink/);
  const { write } = createFsTools({ root });
  await assert.rejects(() => write.run({ path: 'x', content: 'pwned' }), /symlink/);
  assert.equal(existsSync(join(outside, 'evil.plist')), false);
});

test('a symlink loop is rejected instead of being treated as a missing file', { skip: !POSIX }, async () => {
  const { root } = await sandbox();
  await symlink(join(root, 'b'), join(root, 'a'));
  await symlink(join(root, 'a'), join(root, 'b'));
  assert.throws(() => resolveInRoot(root, 'a'), /symlink/);
});

test('swapping a file for an outside link while approval is pending does not write outside', { skip: !POSIX }, async () => {
  const { root, outside } = await sandbox();
  await writeFile(join(root, 'conf.txt'), 'OLD value');
  await writeFile(join(outside, 'victim.txt'), 'untouched');

  const approve = async () => {
    await rm(join(root, 'conf.txt'));
    await symlink(join(outside, 'victim.txt'), join(root, 'conf.txt'));
    return true;
  };
  const { edit, write } = createFsTools({ root, approve });

  await assert.rejects(() => edit.run({ path: 'conf.txt', old: 'OLD', new: 'NEW' }), /symlink/);
  assert.equal(await readFile(join(outside, 'victim.txt'), 'utf8'), 'untouched');

  await rm(join(root, 'conf.txt'));
  await writeFile(join(root, 'conf.txt'), 'OLD value');
  await assert.rejects(() => write.run({ path: 'conf.txt', content: 'x' }), /symlink/);
  assert.equal(await readFile(join(outside, 'victim.txt'), 'utf8'), 'untouched');
});

test('a link that stays inside the project still works for write and edit', { skip: !POSIX }, async () => {
  const { root } = await sandbox();
  await writeFile(join(root, 'real.txt'), 'hello OLD');
  await symlink(join(root, 'real.txt'), join(root, 'alias.txt'));
  const { edit, write } = createFsTools({ root });

  assert.equal((await edit.run({ path: 'alias.txt', old: 'OLD', new: 'NEW' })).ok, true);
  assert.equal(await readFile(join(root, 'real.txt'), 'utf8'), 'hello NEW');
  assert.equal((await write.run({ path: 'alias.txt', content: 'appended', append: true })).ok, true);
  assert.equal(await readFile(join(root, 'real.txt'), 'utf8'), 'hello NEWappended');
});
