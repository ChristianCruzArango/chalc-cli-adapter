// C-03 (spec 016, R18) — la memoria no pierde referencias a archivos con escrituras concurrentes: dos
// `remember` sobre la misma clave conservan el contador Y la unión de archivos, y una compactación no
// se come una línea añadida mientras compactaba.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { remember, readMemory, compactIfNeeded, MEMORY_REL } from '../catalog/memory/lib/store.mjs';

const fresh = () => mkdtemp(join(tmpdir(), 'chalc-c03-'));

test('R18: two concurrent remember calls keep seen=2 and BOTH files (report scenario)', async () => {
  const root = await fresh();
  await Promise.all([
    remember(root, { key: 'audit-same', files: ['a.mjs'], text: 'a' }),
    remember(root, { key: 'audit-same', files: ['b.mjs'], text: 'b' })
  ]);
  const [entry] = (await readMemory(root)).entries;
  assert.equal(entry.seen, 2);
  assert.deepEqual([...entry.files].sort(), ['a.mjs', 'b.mjs']);
});

test('R18: files accumulate across lines without duplicates, and survive compaction', async () => {
  const root = await fresh();
  for (const files of [['a.mjs'], ['b.mjs'], ['a.mjs', 'c.mjs'], []]) await remember(root, { key: 'k', files });
  await remember(root, { key: 'otra', files: [] });   // 5 líneas, 2 entradas: toca compactar
  assert.deepEqual((await readMemory(root)).entries.find((e) => e.key === 'k').files, ['a.mjs', 'b.mjs', 'c.mjs']);
  assert.equal(await compactIfNeeded(root), true);
  const after = (await readMemory(root)).entries.find((e) => e.key === 'k');
  assert.deepEqual([after.seen, after.files], [4, ['a.mjs', 'b.mjs', 'c.mjs']]);
});

test('R18: a line appended while compacting is not lost — the compaction aborts and cleans up', async () => {
  const root = await fresh();
  for (let i = 0; i < 4; i++) await remember(root, { key: 'k', files: [`f${i}.mjs`] });
  const path = join(root, MEMORY_REL);
  const compacted = await compactIfNeeded(root, {
    onWritten: () => appendFile(path, JSON.stringify({ key: 'nueva', inc: 1, files: ['z.mjs'] }) + '\n')
  });
  assert.equal(compacted, false);
  const keys = (await readMemory(root)).entries.map((e) => e.key).sort();
  assert.deepEqual(keys, ['k', 'nueva']);
  assert.deepEqual((await readdir(dirname(path))).filter((f) => f.endsWith('.tmp')), []);
  assert.match(await readFile(path, 'utf8'), /"nueva"/);
});
