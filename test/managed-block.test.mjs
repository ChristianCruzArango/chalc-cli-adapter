// F-04 — el bloque gestionado nunca se lleva por delante lo que escribió el usuario.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeManagedBlock, START, END } from '../lib/targetkit.mjs';

const block = (v) => `${START}\nchalc ${v}\n${END}`;

async function file(content) {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-f04-'));
  const f = join(dir, 'CLAUDE.md');
  if (content !== null) await writeFile(f, content);
  return f;
}

test('the reproduced case: an orphan start keeps the user notes after two runs', async () => {
  const f = await file(`# Mi proyecto\n${START}\nviejo\n## NOTAS DEL USUARIO\nno borrar\n`);
  const warn = console.warn;
  console.warn = () => {};
  try {
    await writeManagedBlock(f, block(1));
    await writeManagedBlock(f, block(2));
  } finally { console.warn = warn; }
  const text = await readFile(f, 'utf8');
  assert.match(text, /NOTAS DEL USUARIO\nno borrar/);
  assert.equal(text.includes('chalc 2'), false);
  assert.equal(await readFile(`${f}.chalc-pending`, 'utf8'), `${block(2)}\n`);
});

test('duplicated or reversed markers are left untouched too', async () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    for (const content of [`${END}\nx\n${START}\n`, `${block(0)}\n${block(0)}\n`, `a\n${END}\n`]) {
      const f = await file(content);
      assert.deepEqual((await writeManagedBlock(f, block(9))).written, false);
      assert.equal(await readFile(f, 'utf8'), content);
    }
  } finally { console.warn = warn; }
});

test('a well-formed block is replaced in place and the rest is kept', async () => {
  const f = await file(`antes\n${block(1)}\ndespués $& $1\n`);
  await writeManagedBlock(f, block('$HOME $&'));
  assert.equal(await readFile(f, 'utf8'), `antes\n${block('$HOME $&')}\ndespués $& $1\n`);
  assert.equal(existsSync(`${f}.chalc-pending`), false);
});

test('a file without markers gets the block appended, and a missing file is created', async () => {
  const f = await file('# mío\n');
  await writeManagedBlock(f, block(1));
  assert.equal(await readFile(f, 'utf8'), `# mío\n\n${block(1)}\n`);
  const g = await file(null);
  await writeManagedBlock(g, block(1));
  assert.equal(await readFile(g, 'utf8'), `${block(1)}\n`);
});
