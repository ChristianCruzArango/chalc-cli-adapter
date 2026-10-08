// spec 015 · T13 (R8, R22) — la spec declara sus conceptos y el método nombra la memoria.
//
// La línea `Conceptos:` es la que decide qué memoria le llega a cada tarea sin preguntarle a un
// modelo cada vez. Tiene que venir en todas las plantillas, y el método tiene que decir de dónde salen
// los nombres —la lista existente—, o «money» y «dinero» vuelven a ser dos conceptos.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SDD = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'catalog', 'methods', 'sdd');
const TEMPLATES = { 'scaffold-lite': 'es', 'scaffold-full': 'es', 'scaffold-lite-en': 'en', 'scaffold-full-en': 'en' };
const RULES = { 'rules-lite.md': 'es', 'rules-full.md': 'es', 'rules-lite.en.md': 'en', 'rules-full.en.md': 'en' };

test('R8: every spec template carries the concepts line, pointing to the existing list', async () => {
  for (const [dir, code] of Object.entries(TEMPLATES)) {
    const text = await readFile(join(SDD, dir, 'specs', '_template', 'spec.md'), 'utf8');
    assert.match(text, code === 'es' ? /^Conceptos: /m : /^Concepts: /m, dir);
    assert.match(text, /node \.chalc\/memory\.mjs concepts/, dir);
  }
});

test('R8: the method asks to fill the concepts line from the existing list when writing a spec', async () => {
  for (const [name, code] of Object.entries(RULES)) {
    const text = await readFile(join(SDD, name), 'utf8');
    assert.match(text, code === 'es' ? /`Conceptos:`/ : /`Concepts:`/, name);
    assert.match(text, /node \.chalc\/memory\.mjs concepts/, name);
  }
});

test('R22: the method names the one-off memory search, to use before exploring the repo', async () => {
  for (const [name, code] of Object.entries(RULES)) {
    const text = await readFile(join(SDD, name), 'utf8');
    assert.match(text, /node \.chalc\/memory\.mjs search/, name);
    assert.match(text, code === 'es' ? /antes de explorar/ : /before exploring/, name);
  }
});
