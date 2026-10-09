// C-05 (spec 016, R20) — ninguna clave i18n se define en dos módulos del mismo idioma: la fusión por
// spread se quedaba con la última y `chalc` preguntaba «¿De dónde viene la historia de usuario?» al
// instalar un skill. El test de paridad (es contra en) no lo veía.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DICT } from '../lib/i18n.mjs';

const MODULES = ['core', 'docs', 'qa', 'commands', 'debate', 'errors'];

async function keysByModule(lang) {
  const out = {};
  for (const name of MODULES) out[name] = Object.keys((await import(`../lib/i18n/${lang}/${name}.mjs`)).default);
  return out;
}

test('R20: every i18n module of the merge is checked (no module left out)', () => {
  for (const lang of ['es', 'en']) {
    const files = readdirSync(new URL(`../lib/i18n/${lang}/`, import.meta.url)).map((f) => f.replace(/\.mjs$/, '')).sort();
    assert.deepEqual(files, [...MODULES].sort(), lang);
  }
});

test('R20: no key is defined in two modules of the same language', async () => {
  for (const lang of ['es', 'en']) {
    const owners = {};
    for (const [mod, keys] of Object.entries(await keysByModule(lang))) for (const k of keys) (owners[k] ||= []).push(mod);
    assert.deepEqual(Object.entries(owners).filter(([, mods]) => mods.length > 1), [], lang);
  }
});

test('R20: installing a skill asks for its source, and the spec flow asks where the story comes from', () => {
  assert.match(DICT.en.installSourceQ, /git url/);
  assert.match(DICT.es.installSourceQ, /url git/);
  assert.match(DICT.en.sourceQ, /user story/);
  assert.match(readFileSync(new URL('../lib/commands/apply.mjs', import.meta.url), 'utf8'), /t\('installSourceQ'\)/);
});
