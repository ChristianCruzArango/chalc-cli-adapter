// M-01 — el analizador de funciones del portón mide bien dos formas habituales de JavaScript que
// antes inflaban el largo (falso `function-too-long`, también en los proyectos del usuario).

import test from 'node:test';
import assert from 'node:assert/strict';
import { lintSource } from '../catalog/gate/lib/smells.mjs';

const LIMITS = { maxFileLines: 300, maxFunctionLines: 3, maxParams: 4, maxDepth: 3 };
const long = (src) => lintSource(src, { file: 'a.mjs', limits: LIMITS }).filter((f) => f.rule === 'function-too-long').map((f) => `${f.data.name}:${f.data.lines}`);

test('a one-line function with braces closes on its own line', () => {
  assert.deepEqual(long('export function a(v) { return v; }\nconst x = 1;\nconst y = 2;\nconst z = 3;\nconst w = 4;\n'), []);
});

test('quotes inside a regex literal do not open a string', () => {
  assert.deepEqual(long('const masked = (value) => (/^["\']/.test(value) ? 1 : 2);\nconst q = 1;\nconst r = 2;\nconst s = 3;\nconst t = 4;\n'), []);
});

test('division is still division', () => {
  assert.deepEqual(long('function f(a, b) {\n  const q = a / b / 2;\n  const s = "x";\n  return q;\n}\n'), ['f:5']);
});
