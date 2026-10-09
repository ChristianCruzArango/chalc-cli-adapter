// C-01 (spec 016, R16) — `edit` no sobrescribe cambios hechos mientras esperaba la aprobación: si el
// archivo cambió entre la lectura y la escritura, no escribe y devuelve un conflicto.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFsTools } from '../cli/tools/fs.mjs';

async function editWith(onApprove) {
  const root = await mkdtemp(join(tmpdir(), 'chalc-c01-'));
  const file = join(root, 'sample.txt');
  await writeFile(file, 'a=1\nb=1\n');
  const tools = createFsTools({ root, approve: async () => { await onApprove(file); return true; } });
  const result = await tools.edit.run({ path: 'sample.txt', old: 'a=1', new: 'a=2' });
  const content = await readFile(file, 'utf8').catch(() => null);
  await rm(root, { recursive: true, force: true });
  return { result, content };
}

test('R16: a concurrent change during approval is kept and reported as a conflict (report scenario)', async () => {
  const { result, content } = await editWith((file) => writeFile(file, 'a=1\nb=2\n'));
  assert.equal(result.ok, undefined);
  assert.equal(result.conflict, true);
  assert.match(result.error, /changed/);
  assert.equal(content, 'a=1\nb=2\n');
});

test('R16: a file deleted during approval is a conflict too, and is not recreated', async () => {
  const { result, content } = await editWith((file) => rm(file));
  assert.equal(result.conflict, true);
  assert.equal(content, null);
});

test('R16: without concurrent changes the edit is applied as before', async () => {
  const { result, content } = await editWith(async () => {});
  assert.equal(result.ok, true);
  assert.equal(content, 'a=2\nb=1\n');
});
