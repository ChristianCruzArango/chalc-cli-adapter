// T2b (spec 025, R17) — `chalc inspect` explica lo mismo que el equipamiento instala: una regla que otra
// incluye (`implies`) sale como suprimida, no como aplicada. Hallado en T2: inspect anunciaba las skills web
// de React en un proyecto Expo, que `apply` no instala.

import test from 'node:test';
import assert from 'node:assert/strict';
import { explainRules, matchRules } from '../lib/detect.mjs';

const ctxWith = (...deps) => ({
  deps: Object.fromEntries(deps.map((d) => [d, '1'])),
  hasFile: () => false,
  glob: () => false,
  globMatches: () => []
});
const RULES = [
  { id: 'global', always: true, skills: ['clean-code'] },
  { id: 'javascript', detect: { anyDependency: ['react'] } },
  { id: 'react', implies: ['javascript'], detect: { anyDependency: ['react'] } },
  { id: 'react-native', implies: ['react', 'javascript'], detect: { anyDependency: ['expo'] } },
  { id: 'python', detect: { anyDependency: ['django'] } }
];
const ids = (list) => list.map((x) => x.rule.id);

test('R17: implied rules are reported as suppressed, with the rules that include them', () => {
  const { applied, implied, misses } = explainRules(RULES, ctxWith('react', 'expo'));
  assert.deepEqual(ids(applied), ['global', 'react-native']);
  assert.deepEqual(implied.map((x) => [x.rule.id, x.by]), [['javascript', ['react', 'react-native']], ['react', ['react-native']]]);
  assert.deepEqual(ids(misses), ['python']);
});

test('R17: applied rules carry their detection reasons', () => {
  const { applied } = explainRules(RULES, ctxWith('react'));
  assert.deepEqual(applied.map((x) => [x.rule.id, x.reasons]), [['global', ['regla global']], ['react', ['dependency react']]]);
});

test('R17: inspect and equip agree — applied rules are exactly what matchRules returns', () => {
  for (const ctx of [ctxWith('react'), ctxWith('react', 'expo'), ctxWith('django'), ctxWith()]) {
    assert.deepEqual(ids(explainRules(RULES, ctx).applied), matchRules(RULES, ctx).map((r) => r.id));
  }
});

test('R17: a global rule is never a miss, and nothing is suppressed when no rule implies another', () => {
  const { implied, misses } = explainRules(RULES, ctxWith());
  assert.deepEqual(implied, []);
  assert.ok(!ids(misses).includes('global'));
});
