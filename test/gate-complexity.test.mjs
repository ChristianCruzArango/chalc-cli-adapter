// Spec 031 (estructura), T1 — una función corta también puede estar enredada (R6, R7). Se cuentan sus caminos:
// cada decisión añade uno. Por encima del límite, se reporta con su nombre.
import test from 'node:test';
import assert from 'node:assert/strict';
import { complexityOf } from '../catalog/gate/lib/complexity.mjs';
import { lintSource } from '../catalog/gate/lib/smells.mjs';
import { LINT_DEFAULTS } from '../catalog/gate/lib/config.mjs';
import { RULES } from '../catalog/gate/lib/rules.mjs';
import { MESSAGES } from '../catalog/gate/lib/i18n.mjs';

const count = (code) => complexityOf(code.split('\n'));

test('R6: una función sin decisiones tiene un solo camino', () => {
  assert.equal(count('function a() {\n  return 1;\n}'), 1);
});

test('R6: cada decisión añade un camino', () => {
  assert.equal(count('if (a) x();'), 2);
  assert.equal(count('if (a) x(); else if (b) y();'), 3);
  assert.equal(count('for (const i of l) x();'), 2);
  assert.equal(count('while (a) x();'), 2);
  assert.equal(count('switch (a) { case 1: x(); break; case 2: y(); break; default: z(); }'), 3);
  assert.equal(count('try { x(); } catch (e) { y(); }'), 2);
  assert.equal(count('return a && b || c;'), 3);
  assert.equal(count('return a ?? b;'), 2);
  assert.equal(count('return a ? b : c;'), 2);
});

test('R6: el encadenamiento opcional, un `forEach` o la palabra dentro de otra no cuentan', () => {
  assert.equal(count('return a?.b?.c;'), 1);
  assert.equal(count('list.forEach(x); const ifx = 1; const format = 2; whileLoop();'), 1);
  assert.equal(count('const t: Foo | Bar = a;'), 1, 'un tipo unión no es una decisión');
});

const limits = { ...LINT_DEFAULTS, maxComplexity: 3 };
const TANGLED = 'export function enredo(a, b) {\n  if (a) return 1;\n  if (b) return 2;\n  if (a && b) return 3;\n  return 0;\n}\n';
const complex = (text, over = {}) => lintSource(text, { file: 'src/a.ts', limits, ...over }).filter((f) => f.rule === RULES.functionTooComplex);

test('R6: una función por encima del límite se reporta con su nombre, su complejidad y el límite', () => {
  assert.deepEqual(complex(TANGLED).map((f) => [f.line, f.data]), [[1, { name: 'enredo', complexity: 5, limit: 3 }]]);
  assert.deepEqual(complex('export function simple(a) {\n  if (a) return 1;\n  return 0;\n}\n'), []);
});

test('R6: en el límite exacto no se reporta, y un texto o un comentario con «if» no cuenta', () => {
  assert.deepEqual(complex('export function justo(a, b) {\n  if (a) return 1;\n  if (b) return 2;\n  return 0;\n}\n'), []);
  assert.deepEqual(complex('export function texto() {\n  // if (a) if (b) if (c) if (d)\n  return "if (a) && (b) || (c)";\n}\n'), []);
});

test('R6: solo se reporta si la tarea escribió dentro de la función', () => {
  const two = TANGLED + '\nexport function otra(a, b) {\n  if (a) return 1;\n  if (b) return 2;\n  if (a && b) return 3;\n  return 0;\n}\n';
  assert.deepEqual(complex(two, { changedLines: new Set([9]) }).map((f) => f.data.name), ['otra']);
});

test('R7: sin maxComplexity no se mide; la config por defecto lo trae en 10', () => {
  const { maxComplexity, ...without } = LINT_DEFAULTS;
  assert.equal(maxComplexity, 10);
  assert.deepEqual(lintSource(TANGLED, { file: 'src/a.ts', limits: without }).filter((f) => f.rule === RULES.functionTooComplex), []);
});

test('el mensaje nombra la función, su complejidad y el límite, en es y en', () => {
  for (const lang of ['es', 'en']) {
    const line = MESSAGES[lang][RULES.functionTooComplex]({ name: 'enredo', complexity: 5, limit: 3 }, lang);
    assert.ok(line.includes('enredo') && line.includes('5') && line.includes('3'), lang);
  }
});
