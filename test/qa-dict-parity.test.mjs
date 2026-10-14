// T6 (spec 022, R19, C4) — el diccionario bilingüe QA de lib/qa/common.mjs tiene paridad exacta es/en,
// como lib/i18n: misma clave, mismo tipo y, en las funciones, la misma aridad.

import test from 'node:test';
import assert from 'node:assert/strict';
import { QA } from '../lib/qa/common.mjs';

const shape = (dict) => Object.fromEntries(Object.entries(dict)
  .map(([key, value]) => [key, typeof value === 'function' ? `fn/${value.length}` : typeof value]));

test('C4: QA tiene exactamente los idiomas es y en', () => {
  assert.deepEqual(Object.keys(QA).sort(), ['en', 'es']);
});

test('C4: QA es/en con las mismas claves, tipos y aridades', () => {
  assert.deepEqual(shape(QA.en), shape(QA.es));
});

test('C4: ningún texto QA vacío', () => {
  for (const code of ['es', 'en']) {
    for (const [key, value] of Object.entries(QA[code])) {
      const text = typeof value === 'function' ? value(...Array(value.length).fill('x')) : value;
      assert.ok(String(text).trim(), `${code}.${key}`);
    }
  }
});
