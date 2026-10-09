// G-03 (spec 016, R12) — un archivo o una función que YA pasaban del límite no pueden crecer sin
// aviso cuando lo que la tarea añadió dentro supera, por sí solo, el límite. Añadir unas pocas líneas
// a algo ya largo sigue sin cobrarse (decisión de diseño vigente, fijada en gate-smells.test.mjs).

import test from 'node:test';
import assert from 'node:assert/strict';
import { lintSource } from '../catalog/gate/lib/smells.mjs';

const LIMITS = { maxFileLines: 300, maxFunctionLines: 40, maxParams: 4, maxDepth: 3, maxCases: 12 };
const of = (findings, rule) => findings.filter((f) => f.rule === rule);
const lint = (text, written, removedLines = 0) =>
  lintSource(text, { file: 'src/precio.ts', limits: LIMITS, changedLines: new Set(written), removedLines });
const range = (from, count) => Array.from({ length: count }, (_, i) => from + i);
const fileOf = (n) => Array.from({ length: n }, (_, i) => `const v${i} = ${i};`).join('\n');
const fnOf = (n) => ['export function total() {', ...Array.from({ length: n }, (_, i) => `  const v${i} = ${i};`), '}'].join('\n');

test('R12: a file of 301 lines that receives 600 more is reported (report example)', () => {
  assert.equal(of(lint(fileOf(901), range(302, 600)), 'file-too-long').length, 1);
});

test('R12: a function of 41 lines that receives 100 more is reported (report example)', () => {
  assert.deepEqual(of(lint(fnOf(141), range(30, 100)), 'function-too-long').map((f) => f.data.name), ['total']);
});

test('R12: the boundary — adding exactly the limit is not reported, one more line is', () => {
  assert.equal(of(lint(fileOf(601), range(302, 300)), 'file-too-long').length, 0);
  assert.equal(of(lint(fileOf(602), range(302, 301)), 'file-too-long').length, 1);
  assert.equal(of(lint(fnOf(81), range(3, 40)), 'function-too-long').length, 0);
  assert.equal(of(lint(fnOf(82), range(3, 41)), 'function-too-long').length, 1);
});

test('R12: removed lines count against file growth (rewriting 400 lines is not growth of 400)', () => {
  assert.equal(of(lint(fileOf(701), range(1, 400), 350), 'file-too-long').length, 0);
  assert.equal(of(lint(fileOf(701), range(1, 400), 99), 'file-too-long').length, 1);
});

test('R12: a few lines added to something already too long are still not blamed on the task', () => {
  assert.equal(of(lint(fileOf(303), [10, 11]), 'file-too-long').length, 0);
  assert.equal(of(lint(fnOf(60), [30, 31]), 'function-too-long').length, 0);
});

test('R12: a file exactly at the limit that the task pushes one line over is reported', () => {
  assert.equal(of(lint(fileOf(301), [301]), 'file-too-long').length, 1);
});
