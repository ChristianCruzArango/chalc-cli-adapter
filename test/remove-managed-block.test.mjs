// T2 (spec 021, R6) — quitar el bloque de chalc de un archivo que ya no le toca.
//
// Al pasar de `GEMINI.md` o `.github/copilot-instructions.md` a `AGENTS.md`, el bloque viejo se quita —si no,
// el harness leería las reglas dos veces—, pero lo que escribió el usuario en ese archivo es suyo y se queda.
// Es la operación inversa de `writeManagedBlock`, con su misma prudencia: marcadores descabalados → no se toca.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { END, START, removeManagedBlock } from '../lib/targetkit/formats.mjs';

const file = async (text) => {
  const path = join(await mkdtemp(join(tmpdir(), 'chalc-remove-block-')), 'GEMINI.md');
  if (text !== undefined) await writeFile(path, text);
  return path;
};
const BLOCK = `${START}\n## ⚙️ Chalc\n- regla\n${END}`;

test('R6: only the chalc block goes; what the user wrote stays, byte for byte around it', async () => {
  const path = await file(`# Mis notas\n\nNo tocar.\n\n${BLOCK}\n\n## Más mío\nTexto.\n`);
  assert.deepEqual(await removeManagedBlock(path), { removed: true, deleted: false });
  assert.equal(await readFile(path, 'utf8'), '# Mis notas\n\nNo tocar.\n\n## Más mío\nTexto.\n');
});

test('R6: a file that only had the chalc block is deleted', async () => {
  const path = await file(`${BLOCK}\n`);
  assert.deepEqual(await removeManagedBlock(path), { removed: true, deleted: true });
  assert.ok(!existsSync(path));
  const spaces = await file(`\n\n${BLOCK}\n\n  \n`);
  assert.deepEqual(await removeManagedBlock(spaces), { removed: true, deleted: true });
});

test('R6: a file without the block, or no file at all, is left alone', async () => {
  const mine = await file('# Solo mío\n');
  assert.deepEqual(await removeManagedBlock(mine), { removed: false, deleted: false });
  assert.equal(await readFile(mine, 'utf8'), '# Solo mío\n');
  assert.deepEqual(await removeManagedBlock(await file()), { removed: false, deleted: false });
});

test('R6: unpaired or reversed markers: nothing is touched', async () => {
  for (const text of [`${START}\nhuérfano\n# mío\n`, `# mío\n${END}\n`, `${END}\nx\n${START}\n`, `${BLOCK}\n${BLOCK}\n`]) {
    const path = await file(text);
    assert.deepEqual(await removeManagedBlock(path), { removed: false, deleted: false }, text);
    assert.equal(await readFile(path, 'utf8'), text);
  }
});

test('R6: the block at the very start or end leaves no stray blank lines', async () => {
  const start = await file(`${BLOCK}\n\n# Mío\n`);
  await removeManagedBlock(start);
  assert.equal(await readFile(start, 'utf8'), '# Mío\n');
  const end = await file(`# Mío\n\n${BLOCK}\n`);
  await removeManagedBlock(end);
  assert.equal(await readFile(end, 'utf8'), '# Mío\n');
});

// Los casos de abajo salen de la pasada de mutación.
test('R6: one start with two ends is unpaired too; text glued to the block keeps its own spaces', async () => {
  const twoEnds = await file(`${START}\na\n${END}\nb\n${END}\n`);
  assert.deepEqual(await removeManagedBlock(twoEnds), { removed: false, deleted: false });
  const glued = await file(`${BLOCK}Pegado al bloque, con espacios\n`);
  await removeManagedBlock(glued);
  assert.equal(await readFile(glued, 'utf8'), 'Pegado al bloque, con espacios\n');
});
