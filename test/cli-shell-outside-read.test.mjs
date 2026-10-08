// S-14 — la herramienta bash no lee archivos de fuera del proyecto escondiendo la ruta como valor de
// una opción ni a través de un enlace interno.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createShellTool } from '../cli/tools/shell.mjs';

const root = await mkdtemp(join(tmpdir(), 'chalc-s14-'));
const outside = await mkdtemp(join(tmpdir(), 'chalc-s14-out-'));
await writeFile(join(outside, 'secret.txt'), 'secret');
await writeFile(join(root, 'inside.txt'), 'ok');
const { bash } = createShellTool({ root, allow: ['cat', 'ng', 'ls'], approve: async () => false });
const SECRET = join(outside, 'secret.txt');

test('an existing outside file is blocked even as the value of an option', async () => {
  for (const cmd of [`cat --number ${SECRET}`, `cat --number=${SECRET}`, `ls --hide ${outside}`]) {
    assert.match((await bash.run({ command: cmd })).error, /outside the project/, cmd);
  }
});

test('an inner symlink that points outside is blocked', { skip: process.platform === 'win32' }, async () => {
  await symlink(SECRET, join(root, 'link.txt'));
  assert.match((await bash.run({ command: 'cat link.txt' })).error, /outside the project is not allowed: link\.txt/);
});

test('option values that are data, not files, still reach the approval', async () => {
  for (const cmd of ['ng build --base-href /chalc-no-such-dir/', 'cat inside.txt', 'cat --number inside.txt', 'ls https://example.com/x']) {
    assert.match((await bash.run({ command: cmd })).error, /not approved/, cmd);
  }
});
