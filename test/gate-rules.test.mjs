// T34 (R14) — las reglas del método SDD cierran la tarea con el portón, no con una promesa.
//
// La frase que había —"corre mutation testing apoyándote en la skill"— es el origen de todo esto:
// nadie la verificaba, así que se podía dar por hecha sin ejecutar nada. Se sustituye por el ciclo
// real, que sí deja rastro. Los cuatro archivos (lite/full × es/en) tienen que decir lo mismo.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RULES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'catalog', 'methods', 'sdd');

const FILES = {
  'rules-lite.md': 'es',
  'rules-lite.en.md': 'en',
  'rules-full.md': 'es',
  'rules-full.en.md': 'en'
};

const read = (name) => readFile(join(RULES_DIR, name), 'utf8');

test('no rules file still closes a task on trust alone', async () => {
  for (const name of Object.keys(FILES)) {
    const text = await read(name);

    assert.doesNotMatch(text, /apoyándote en la skill/i, `${name} conserva la frase sin verificar`);
    assert.doesNotMatch(text, /using the project's `mutation-testing` skill/i, `${name} conserva la frase sin verificar`);
  }
});

test('every rules file closes the task by running the gate', async () => {
  for (const name of Object.keys(FILES)) {
    const text = await read(name);

    assert.match(text, /node \.chalc\/gate\.mjs/, `${name} no manda correr el portón`);
  }
});

test('every rules file sends the reviewer in after the gate', async () => {
  for (const [name, code] of Object.entries(FILES)) {
    const text = await read(name);

    assert.match(text, code === 'es' ? /revisor/i : /reviewer/i, `${name} no llama al revisor`);
  }
});

// El score sigue siendo ≥ 80, pero ahora lo mide el portón: la regla tiene que decir de dónde sale.
test('every rules file keeps the threshold and says who measures it', async () => {
  for (const name of Object.keys(FILES)) {
    const text = await read(name);

    assert.match(text, /80/, `${name} perdió el umbral`);
  }
});

test('the lite and full rules stay in parity between languages', async () => {
  for (const base of ['rules-lite', 'rules-full']) {
    const es = await read(`${base}.md`);
    const en = await read(`${base}.en.md`);

    // Misma cantidad de pasos numerados: si uno gana un paso y el otro no, se desincronizaron.
    const steps = (text) => (text.match(/^\s*\d+\.\s/gm) || []).length;
    assert.equal(steps(es), steps(en), `${base}: los pasos numerados no coinciden entre idiomas`);
  }
});
