// C-04 (spec 016, R19) — los .doc/.xls heredados se convierten por la ruta de RESPALDO (soffice,
// antiword) sin `ReferenceError`. Antes `legacyOfficeToText` llamaba a `convert` y `basename`, que no
// existían en el módulo: fuera de macOS, o con textutil fallando, toda lectura terminaba en error.

import test from 'node:test';
import assert from 'node:assert/strict';
import { legacyOfficeToText } from '../lib/docread/external.mjs';
import { t } from '../lib/i18n.mjs';
import { readDocument } from '../lib/docread.mjs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PATH = '/docs/viejo.doc';
const failing = () => { throw new Error('no instalado'); };

test('R19: without textutil nor soffice nor antiword it fails with the translated message, not ReferenceError', async () => {
  await assert.rejects(
    () => legacyOfficeToText(PATH, '.doc', { platform: 'linux', convert: async () => null, run: failing }),
    (e) => !(e instanceof ReferenceError) && e.message === t('docLegacyNoTool', 'viejo.doc', '.doc')
  );
});

test('R19: the soffice fallback is used outside macOS', async () => {
  const seen = [];
  const text = await legacyOfficeToText(PATH, '.doc', { platform: 'linux', convert: async (p) => { seen.push(p); return 'desde soffice'; }, run: failing });
  assert.equal(text, 'desde soffice');
  assert.deepEqual(seen, [PATH]);
});

test('R19: .doc falls back to antiword when soffice is missing; .xls does not try antiword', async () => {
  const calls = [];
  const run = (cmd, args) => { calls.push([cmd, args]); return '  hola  \n'; };
  assert.equal(await legacyOfficeToText(PATH, '.doc', { platform: 'linux', convert: async () => null, run }), 'hola');
  assert.deepEqual(calls, [['antiword', [PATH]]]);
  calls.length = 0;
  await assert.rejects(() => legacyOfficeToText('/d/v.xls', '.xls', { platform: 'linux', convert: async () => null, run }));
  assert.deepEqual(calls, []);
});

test('R19: on macOS textutil goes first; if it fails, the fallback still works', async () => {
  const ok = await legacyOfficeToText(PATH, '.doc', {
    platform: 'darwin', convert: async () => 'no debería', run: (cmd) => (cmd === 'textutil' ? ' de textutil ' : failing())
  });
  assert.equal(ok, 'de textutil');
  const fallback = await legacyOfficeToText(PATH, '.doc', { platform: 'darwin', convert: async () => 'desde soffice', run: failing });
  assert.equal(fallback, 'desde soffice');
});

test('R19: readDocument passes its injected converter down to the legacy fallback', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-c04-'));
  const file = join(dir, 'presentacion.odp');
  await writeFile(file, 'no es un odp real');
  const injected = { platform: 'linux', run: failing, convert: async () => 'via convert inyectado' };
  assert.equal(await readDocument(file, injected), 'via convert inyectado');
});
