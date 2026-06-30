import test from 'node:test';
import assert from 'node:assert/strict';
import { DICT, t } from '../lib/i18n.mjs';

test('every translation key exists in both es and en (no orphans)', () => {
  const es = new Set(Object.keys(DICT.es));
  const en = new Set(Object.keys(DICT.en));

  const missingInEn = [...es].filter((k) => !en.has(k));
  const missingInEs = [...en].filter((k) => !es.has(k));

  assert.deepEqual(missingInEn, [], `Claves en es sin equivalente en en: ${missingInEn.join(', ')}`);
  assert.deepEqual(missingInEs, [], `Claves en en sin equivalente en es: ${missingInEs.join(', ')}`);
});

test('keys of the same type in both languages (string vs function)', () => {
  const mismatches = Object.keys(DICT.es)
    .filter((k) => k in DICT.en)
    .filter((k) => typeof DICT.es[k] !== typeof DICT.en[k]);
  assert.deepEqual(mismatches, [], `Claves con tipo distinto entre es/en: ${mismatches.join(', ')}`);
});

test('t() returns the requested key as last-resort fallback for unknown keys', () => {
  assert.equal(t('__no_such_key__'), '__no_such_key__');
});
