// T5 (spec 023, R7) — un archivo LOCAL del asistente fuera de git, con su propia cabecera.
//
// Claude Code solo saca `.claude/settings.local.json` de git cuando lo crea él; si lo crea chalc, hay que
// nombrarlo en el `.gitignore`. `ensureIgnored` añade un bloque con las entradas que falten, una vez, al
// final, sin tocar lo del usuario. Una entrada ya cuenta si el `.gitignore` nombra ella misma o cualquiera de
// sus carpetas (`.claude/`, `.claude/*`…): git ignora entonces todo lo que hay dentro.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { ensureIgnored, ensureLocalIgnores, LOCAL_IGNORES } from '../lib/gitignore-local.mjs';

const SETTINGS = '.claude/settings.local.json';

async function after(t, initial, entries = [SETTINGS]) {
  const dir = await tempDir(t, 'chalc-ignore-');
  if (initial !== undefined) await writeFile(join(dir, '.gitignore'), initial);
  const changed = await ensureIgnored(dir, entries, 'cabecera');
  return { changed, text: await readFile(join(dir, '.gitignore'), 'utf8').catch(() => null) };
}

test('R7: the local settings file is added under the header it was given', async (t) => {
  assert.deepEqual(await after(t), { changed: true, text: `# cabecera\n${SETTINGS}\n` });
  assert.deepEqual(await after(t, 'dist/\n'), { changed: true, text: `dist/\n\n# cabecera\n${SETTINGS}\n` });
});

test('R7: adding it twice writes it once', async (t) => {
  const dir = await tempDir(t, 'chalc-ignore-');
  assert.equal(await ensureIgnored(dir, [SETTINGS], 'cabecera'), true);
  const text = await readFile(join(dir, '.gitignore'), 'utf8');
  assert.equal(await ensureIgnored(dir, [SETTINGS], 'cabecera'), false);
  assert.equal(await readFile(join(dir, '.gitignore'), 'utf8'), text);
});

test('R7: a line that ignores its folder already covers it', async (t) => {
  for (const line of ['.claude', '.claude/', '/.claude/', '  .claude/  ', '.claude/*', '.claude/**', `/${SETTINGS}`]) {
    assert.deepEqual(await after(t, `${line}\n`), { changed: false, text: `${line}\n` }, line);
  }
});

test('R7: another folder, or one whose name only starts the same, does not cover it', async (t) => {
  for (const line of ['.chalc/', '.claude-old/', '.cla', 'settings.local.json/', '.claude/settings', `${SETTINGS}/*`, `${SETTINGS}/**`]) {
    assert.equal((await after(t, `${line}\n`)).changed, true, line);
  }
});

test('R7: an intermediate folder covers what is inside it', async (t) => {
  assert.equal((await after(t, '.chalc/memory/\n', ['.chalc/memory/state.json'])).changed, false);
  assert.equal((await after(t, '.chalc/memory/*\n', ['.chalc/memory/state.json'])).changed, false);
});

test('R7: only the missing entries of a list are added', async (t) => {
  assert.equal((await after(t, 'a/x\n', ['a/x', 'b/y'])).text, 'a/x\n\n# cabecera\nb/y\n');
});

test('R7: the .chalc artifacts keep their own block when .chalc is ignored as a whole', async (t) => {
  const dir = await tempDir(t, 'chalc-ignore-');
  await writeFile(join(dir, '.gitignore'), '.chalc/\n');
  assert.equal(await ensureLocalIgnores(dir), false);
  assert.equal(await ensureIgnored(dir, [SETTINGS], 'cabecera'), true);
  assert.equal(await readFile(join(dir, '.gitignore'), 'utf8'), `.chalc/\n\n# cabecera\n${SETTINGS}\n`);
  assert.equal(LOCAL_IGNORES.includes(SETTINGS), false);
});
