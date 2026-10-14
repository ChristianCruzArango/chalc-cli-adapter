// T2 (spec 022, R17, S9 fs/fshints) — `read` abre la ruta real confinada sin seguir enlaces y mide el
// archivo ABIERTO; `edit` no carga archivos enormes ni binarios; los avisos de referencias locales no
// revelan qué existe fuera del proyecto.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink, readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFsTools, missingLocalRefs } from '../cli/tools/fs.mjs';
import { readConfinedBytes } from '../cli/tools/saferead.mjs';

async function sandbox(t) {
  const base = await mkdtemp(join(tmpdir(), 'chalc-022-g2-fs-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, 'proj');
  await mkdir(join(root, 'src'), { recursive: true });
  return { base, root };
}

// T2 (spec 022, R17, S9 fs read)
test('T2 (spec 022, R17, S9 fs read): readConfinedBytes refuses to follow a link at open time (O_NOFOLLOW)', { skip: process.platform === 'win32' }, async (t) => {
  const { root } = await sandbox(t);
  await writeFile(join(root, 'a.txt'), 'hola');
  const r = await readConfinedBytes(root, 'a.txt', 1024);
  assert.equal(r.buf.toString('utf8'), 'hola');
  assert.equal(r.size, 4);
  // El tope se aplica sobre el archivo ABIERTO: sin leer el contenido.
  const big = await readConfinedBytes(root, 'a.txt', 2);
  assert.equal(big.size, 4);
  assert.equal(big.buf, null);
});

test('T2 (spec 022, R17, S9 fs read): the read tool goes through the confined no-follow reader', () => {
  const src = readFileSync(new URL('../cli/tools/fs.mjs', import.meta.url), 'utf8');
  assert.match(src, /readConfinedBytes/);
  const readBody = src.slice(src.indexOf('function readTool'), src.indexOf('function listTool'));
  const editBody = src.slice(src.indexOf('function editTool'), src.indexOf('export function createFsTools'));
  for (const body of [readBody, editBody]) assert.doesNotMatch(body, /readFile\(/);
});

test('T2 (spec 022, R17, S9 fs read): read keeps its behaviour (inner link ok, outer link refused, big and binary)', { skip: process.platform === 'win32' }, async (t) => {
  const { base, root } = await sandbox(t);
  const { read } = createFsTools({ root });
  await writeFile(join(base, 'outside.txt'), 'SECRETO_FUERA');
  await writeFile(join(root, 'src', 'real.txt'), 'dentro');
  await symlink(join(root, 'src', 'real.txt'), join(root, 'inner-link.txt'));
  await symlink(join(base, 'outside.txt'), join(root, 'outer-link.txt'));
  await writeFile(join(root, 'big.txt'), 'x'.repeat(300 * 1024));
  await writeFile(join(root, 'bin.dat'), Buffer.from([1, 0, 2]));
  assert.equal((await read.run({ path: 'inner-link.txt' })).content, 'dentro');
  await assert.rejects(() => read.run({ path: 'outer-link.txt' }), /outside the project/);
  assert.match((await read.run({ path: 'big.txt' })).error, /large file/);
  assert.match((await read.run({ path: 'bin.dat' })).error, /binary/);
  assert.match((await read.run({ path: 'nope.txt' })).error, /does not exist/);
  assert.ok(Array.isArray((await read.run({ path: 'src' })).entries));
});

// T2 (spec 022, R17, S9 fs edit)
test('T2 (spec 022, R17, S9 fs edit): edit refuses a file over the read cap without asking approval', async (t) => {
  const { root } = await sandbox(t);
  let asked = 0;
  const { edit } = createFsTools({ root, approve: async () => { asked++; return true; } });
  await writeFile(join(root, 'huge.txt'), 'needle ' + 'x'.repeat(300 * 1024));
  const r = await edit.run({ path: 'huge.txt', old: 'needle', new: 'pin' });
  assert.match(r.error, /large file/);
  assert.equal(asked, 0);
  assert.ok((await readFile(join(root, 'huge.txt'), 'utf8')).startsWith('needle'));
});

test('T2 (spec 022, R17, S9 fs edit): edit refuses a binary file', async (t) => {
  const { root } = await sandbox(t);
  const { edit } = createFsTools({ root });
  await writeFile(join(root, 'img.png'), Buffer.concat([Buffer.from('needle'), Buffer.from([0, 1, 2])]));
  const r = await edit.run({ path: 'img.png', old: 'needle', new: 'pin' });
  assert.match(r.error, /binary/);
});

test('T2 (spec 022, R17, S9 fs edit): edit still replaces in a normal text file', async (t) => {
  const { root } = await sandbox(t);
  const { edit } = createFsTools({ root });
  await writeFile(join(root, 'a.txt'), 'uno dos');
  assert.equal((await edit.run({ path: 'a.txt', old: 'dos', new: 'tres' })).ok, true);
  assert.equal(await readFile(join(root, 'a.txt'), 'utf8'), 'uno tres');
  assert.match((await edit.run({ path: 'missing.txt', old: 'a', new: 'b' })).error, /does not exist/);
});

// T2 (spec 022, R17, S9 fshints)
test('T2 (spec 022, R17, S9 fshints): references that escape the root are never probed nor reported', async (t) => {
  const { base, root } = await sandbox(t);
  await writeFile(join(base, 'exists-outside.ts'), 'x');
  const file = join(root, 'src', 'a.ts');
  const content = "import a from '../../exists-outside';\nimport b from '../../missing-outside';\nimport c from './local-missing';\n";
  assert.deepEqual(await missingLocalRefs(file, content, root), ['./local-missing']);
});

test('T2 (spec 022, R17, S9 fshints): the write hint does not leak existence of files outside the project', async (t) => {
  const { base, root } = await sandbox(t);
  await writeFile(join(base, 'exists-outside.ts'), 'x');
  const { write } = createFsTools({ root });
  const r = await write.run({ path: 'src/a.ts', content: "import a from '../../exists-outside';\nimport b from '../../missing-outside';\n" });
  assert.equal(r.ok, true);
  assert.doesNotMatch(r.hint || '', /outside/);
});
