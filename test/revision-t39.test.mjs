// T39 (spec 016, R39) — el idioma de la INTERFAZ sigue la precedencia de CLAUDE.md:
// `--lang` > `CHALC_LANG` > config guardada > `LANG/LC_*` > `en`. Antes `--lang` no se aplicaba.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { detectLang, langFromArgv } from '../lib/i18n.mjs';

const BIN = fileURLToPath(new URL('../bin/chalc.mjs', import.meta.url));
const usage = (args, env) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', env: { ...process.env, ...env }, input: '' }).stdout;

test('R39: --lang is read from the command line (both spellings, last one wins)', () => {
  assert.equal(langFromArgv(['spec-ia', '--lang', 'en']), 'en');
  assert.equal(langFromArgv(['--lang=es', 'feature']), 'es');
  assert.equal(langFromArgv(['--lang', 'es', '--lang', 'en']), 'en');
  assert.equal(langFromArgv(['qa', 'demo']), undefined);
  assert.equal(langFromArgv(['--lang']), undefined);
  assert.equal(langFromArgv(['--lang', '--yes']), undefined);   // la flag siguiente no es un idioma
  assert.equal(detectLang(langFromArgv(['--lang='])), detectLang());   // vacío: decide el siguiente escalón
});

test('R39: the override accepts codes and language names', () => {
  for (const [value, code] of [['es', 'es'], ['es-MX', 'es'], ['español', 'es'], ['Spanish', 'es'], ['castellano', 'es'], ['en', 'en'], ['English', 'en'], ['en_US', 'en'], ['fr', 'en']]) {
    assert.equal(detectLang(value), code, value);
  }
});

test('R39: end to end, --lang beats CHALC_LANG for the interface', { timeout: 30000 }, () => {
  assert.match(usage(['--help', '--lang', 'en'], { CHALC_LANG: 'es' }), /^Usage: chalc/m);
  assert.match(usage(['--help', '--lang', 'es'], { CHALC_LANG: 'en' }), /^Uso: chalc/m);
  assert.match(usage(['--help'], { CHALC_LANG: 'es' }), /^Uso: chalc/m);
  assert.match(usage(['--help'], { CHALC_LANG: 'en' }), /^Usage: chalc/m);
});
