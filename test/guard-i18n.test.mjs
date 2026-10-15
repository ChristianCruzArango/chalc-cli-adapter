// T7 (spec 023, R11) — los textos de la guarda, en es y en.
//
// El paso de la guarda (`guardstep.mjs`, T8) solo muestra lo que devuelve `t()`: la pregunta de `init`, un
// aviso por cada estado de `guardemit.mjs`, el de un destino que no es Claude Code, las líneas del dry-run y
// la ayuda de los flags. Se leen los dos diccionarios directamente, sea cual sea `CHALC_LANG`. Lo que no se
// traduce —la ruta del archivo, los comandos de git y los flags— sale idéntico en los dos idiomas.

import test from 'node:test';
import assert from 'node:assert/strict';
import { DICT } from '../lib/i18n.mjs';
import { GUARD_IGNORE } from '../lib/guardemit.mjs';
import { GUARD_STATUS } from '../lib/guardstatus.mjs';

const LANGS = ['es', 'en'];
const TEXTS = ['guardQ', 'guardAdded', 'guardUnchanged', 'guardRemoved', 'guardAbsent', 'guardInvalid', 'guardDryAdd', 'guardDryRemove'];
// Cada estado que devuelve `guardemit.mjs` tiene su aviso: `added` → `guardAdded`…
const statusKey = (status) => `guard${status[0].toUpperCase()}${status.slice(1)}`;

test('R11: every guard text exists in both languages, as text', () => {
  for (const lang of LANGS) {
    for (const key of TEXTS) assert.equal(typeof DICT[lang][key], 'string', `${lang}.${key}`);
    assert.equal(typeof DICT[lang].guardOnlyClaude, 'function', `${lang}.guardOnlyClaude`);
  }
});

test('R11: every state of the guard on disk has its own message', () => {
  for (const status of Object.values(GUARD_STATUS)) assert.ok(TEXTS.includes(statusKey(status)), status);
});

test('R11: the messages about the file name it exactly as it is on disk', () => {
  for (const lang of LANGS) {
    for (const key of TEXTS.filter((key) => key !== 'guardQ')) assert.ok(DICT[lang][key].includes(GUARD_IGNORE), `${lang}.${key}`);
  }
});

test('R11, R13: the init question names the two commands it guards', () => {
  for (const lang of LANGS) {
    assert.match(DICT[lang].guardQ, /git commit/, lang);
    assert.match(DICT[lang].guardQ, /git push/, lang);
  }
});

test('R9, R11: the warning for another assistant names it and says the guard is only for Claude Code', () => {
  for (const lang of LANGS) {
    const text = DICT[lang].guardOnlyClaude('codex');
    assert.match(text, /codex/, lang);
    assert.match(text, /Claude Code/, lang);
  }
});

test('R11, R14, R15: the usage shows both flags', () => {
  for (const lang of LANGS) {
    assert.match(DICT[lang].usage, /--guard\b/, lang);
    assert.match(DICT[lang].usage, /--no-guard\b/, lang);
  }
});
