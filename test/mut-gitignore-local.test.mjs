// T10 (spec 022, R14, S7a) — mutantes: el texto EXACTO que se añade al `.gitignore` (separación con lo que
// ya había, cabecera, una entrada por línea) y la comparación tolerante de líneas (espacios, `/` inicial y
// final) que evita duplicar lo que el usuario ya escribió a su manera.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { LOCAL_IGNORES, ensureLocalIgnores } from '../lib/gitignore-local.mjs';
import { t as tr } from '../lib/i18n.mjs';

const block = (entries) => `# ${tr('gitignoreLocalHeader')}\n${entries.join('\n')}\n`;

async function after(t, initial) {
  const dir = await tempDir(t, 'chalc-mut-ignore-');
  if (initial !== undefined) await writeFile(join(dir, '.gitignore'), initial);
  const changed = await ensureLocalIgnores(dir);
  return { changed, text: await readFile(join(dir, '.gitignore'), 'utf8').catch(() => null) };
}

// T10 (spec 022, R14, S7a)
test('S7a: with no .gitignore, the file is exactly the header and the five entries', async (t) => {
  assert.deepEqual(await after(t), { changed: true, text: block(LOCAL_IGNORES) });
});

// T10 (spec 022, R14, S7a)
test('S7a: an empty .gitignore gets the block with no leading blank line', async (t) => {
  assert.deepEqual(await after(t, ''), { changed: true, text: block(LOCAL_IGNORES) });
});

// T10 (spec 022, R14, S7a)
test('S7a: the block is separated by one blank line, whether or not the file ended in a newline', async (t) => {
  assert.equal((await after(t, 'dist/\n')).text, `dist/\n\n${block(LOCAL_IGNORES)}`);
  assert.equal((await after(t, 'dist/')).text, `dist/\n\n${block(LOCAL_IGNORES)}`);
});

// T10 (spec 022, R14, S7a)
test('S7a: entries written with spaces or with a leading or trailing slash count as present', async (t) => {
  const initial = '  .chalc/live.json  \n/.chalc/activity.jsonl\n.chalc/usage.lock\n/.chalc/usage.json/\n';
  assert.equal((await after(t, initial)).text, `${initial}\n${block(['.chalc/memory/state.json'])}`);
});

// T10 (spec 022, R14, S7a)
test('S7a: a whole-folder line counts even when indented', async (t) => {
  assert.deepEqual(await after(t, '  .chalc/  \n'), { changed: false, text: '  .chalc/  \n' });
});

// T10 (spec 022, R14, S7a)
test('S7a: nothing missing means nothing written', async (t) => {
  const initial = `${LOCAL_IGNORES.join('\n')}\n`;
  assert.deepEqual(await after(t, initial), { changed: false, text: initial });
});
