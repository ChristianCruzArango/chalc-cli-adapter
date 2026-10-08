// M-02 — ningún fuente lleva bytes de control literales.
//
// Un NUL literal hace que git trate el archivo como binario: `mutation.mjs` llegó a mostrarse como
// «Bin 14712 -> 14876 bytes» y ninguno de sus cambios se pudo revisar en un diff. La secuencia
// escapada (`'\u0000'`) produce el mismo valor y deja el archivo como texto.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIRS = ['bin', 'cli', 'lib', 'targets', 'catalog', 'rules', 'test'];
const TEXT = /\.(mjs|cjs|js|ts|json|md|mdc|xml|ya?ml|toml|sh|py|txt)$/i;
const SKIP = new Set(['node_modules', '.git', 'fixtures']);
// Controles C0 salvo tabulador, salto de línea y retorno de carro.
const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f]/;

async function* files(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(abs);
    else if (TEXT.test(entry.name)) yield abs;
  }
}

test('source files contain no literal control bytes', async () => {
  const offenders = [];
  for (const dir of DIRS) {
    for await (const file of files(join(ROOT, dir))) {
      const text = await readFile(file, 'latin1');
      const at = text.search(CONTROL);
      if (at >= 0) offenders.push(`${relative(ROOT, file)} (byte 0x${text.charCodeAt(at).toString(16)} at ${at})`);
    }
  }
  assert.deepEqual(offenders, []);
});
