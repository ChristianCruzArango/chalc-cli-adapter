// T10 (spec 018, R7, R8) — leer lo que el proyecto eligió, sin romper con manifiestos viejos o rotos.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { methodEntries, readChoices } from '../lib/manifest.mjs';

const NONE = { lang: '', methods: [], architecture: null };
const withManifest = async (content) => {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-choices-'));
  if (content !== undefined) await writeFile(join(dir, '.chalc.json'), typeof content === 'string' ? content : JSON.stringify(content));
  return dir;
};

test('R7: the stored language, methods with their mode, and architecture are read', async () => {
  const dir = await withManifest({ lang: 'es', methods: ['sdd:lite', 'otro'], architecture: { id: 'modular-feature', name: 'NestJS Modular' } });
  assert.deepEqual(await readChoices(dir), {
    lang: 'es',
    methods: [{ id: 'sdd', mode: 'lite' }, { id: 'otro', mode: '' }],
    architecture: { id: 'modular-feature', name: 'NestJS Modular' }
  });
});

test('R8: no manifest, broken JSON, or a non-object give no choices', async () => {
  for (const content of [undefined, '{ roto', 'null', '"texto"']) {
    assert.deepEqual(await readChoices(await withManifest(content)), NONE, String(content));
  }
});

test('R8: an old manifest without the new fields gives no language and no architecture', async () => {
  assert.deepEqual(await readChoices(await withManifest({ target: 'claude', methods: ['sdd'] })), { lang: '', methods: [{ id: 'sdd', mode: '' }], architecture: null });
});

test('R8: values that are not what was written are ignored', async () => {
  const dir = await withManifest({ lang: 'fr', methods: 'sdd', architecture: { id: 'x', name: '' } });
  assert.deepEqual(await readChoices(dir), NONE);
  assert.deepEqual(await readChoices(await withManifest({ lang: 'en', methods: [':lite'], architecture: { name: 42 } })), { lang: 'en', methods: [], architecture: null });
});

test('R7: --method entries win; without them the remembered ones are used', () => {
  const choices = { methods: [{ id: 'sdd', mode: 'lite' }, { id: 'otro', mode: '' }] };
  assert.deepEqual(methodEntries(['sdd:full'], choices), ['sdd:full']);
  assert.deepEqual(methodEntries([], choices), ['sdd:lite', 'otro']);
  assert.deepEqual(methodEntries([], { methods: [] }), []);
});
