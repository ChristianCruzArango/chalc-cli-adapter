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

// T8 (spec 022, R19, C4) — los diccionarios bilingües que viven fuera de lib/i18n también exigen paridad
// exacta es/en: mismas claves (a cualquier profundidad) y mismo tipo en cada una. `QA` (lib/qa/common.mjs)
// tiene su propio test.
const { HANDOFF_WORDS } = await import('../lib/commands/specgen.mjs');
const { LABELS } = await import('../catalog/live/lib/labels.mjs');

// Diferencias de forma entre dos ramas: claves que faltan en una u otra y tipos distintos.
function shapeDiff(a, b, path = '') {
  const out = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const p = path ? `${path}.${k}` : k;
    if (!(k in a) || !(k in b)) { out.push(`${p}: solo en ${k in a ? 'es' : 'en'}`); continue; }
    const [ta, tb] = [typeof a[k], typeof b[k]];
    if (ta !== tb || Array.isArray(a[k]) !== Array.isArray(b[k])) out.push(`${p}: tipo distinto`);
    else if (ta === 'object' && a[k] && !Array.isArray(a[k])) out.push(...shapeDiff(a[k], b[k], p));
  }
  return out;
}

test('C4: shapeDiff detecta claves huérfanas y tipos distintos a cualquier profundidad', () => {
  assert.deepEqual(shapeDiff({ a: 1, n: { x: 'a', f: () => 1 } }, { b: 1, n: { x: 'b', f: 'no' } }),
    ['a: solo en es', 'n.f: tipo distinto', 'b: solo en en']);
});

for (const [name, dict] of [['HANDOFF_WORDS (lib/commands/specgen.mjs)', HANDOFF_WORDS], ['LABELS (catalog/live/lib/labels.mjs)', LABELS]]) {
  test(`C4: ${name} tiene exactamente es y en, con paridad de claves y tipos`, () => {
    assert.ok(dict && typeof dict === 'object', `${name} debe exportarse`);
    assert.deepEqual(Object.keys(dict).sort(), ['en', 'es']);
    assert.deepEqual(shapeDiff(dict.es, dict.en), []);
  });
}
