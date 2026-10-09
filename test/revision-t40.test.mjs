// T40 (spec 016, R40) — criterio literal de G-03: si la tarea hace CRECER algo que ya superaba el
// límite, se reporta `oversized-grew`. `file-too-long`/`function-too-long` siguen sin cobrar la deuda
// previa (lo fijan los tests de gate-smells); esta regla nueva dice «lo agrandaste».

import test from 'node:test';
import assert from 'node:assert/strict';
import { lintSource } from '../catalog/gate/lib/smells.mjs';
import { RULES } from '../catalog/gate/lib/rules.mjs';
import { messageOf } from '../catalog/gate/lib/i18n.mjs';

const LIMITS = { maxFileLines: 300, maxFunctionLines: 40, maxParams: 4, maxDepth: 3, maxCases: 12 };
const lint = (text, written, removedLines = 0) => lintSource(text, { file: 'src/precio.ts', limits: LIMITS, changedLines: new Set(written), removedLines });
const of = (findings, rule) => findings.filter((f) => f.rule === rule);
const fileOf = (n) => Array.from({ length: n }, (_, i) => `const v${i} = ${i};`).join('\n');
const fnOf = (n) => ['export function total() {', ...Array.from({ length: n }, (_, i) => `  const v${i} = ${i};`), '}'].join('\n');

test('R40: a file already over the limit that grows by 2 lines is reported as oversized-grew (not file-too-long)', () => {
  const found = lint(fileOf(303), [10, 11]);
  assert.deepEqual(of(found, RULES.fileTooLong), []);
  assert.deepEqual(of(found, RULES.oversizedGrew).map((f) => f.data), [{ kind: 'file', before: 301, after: 303, limit: 300 }]);
});

test('R40: rewriting lines without net growth is not reported', () => {
  assert.deepEqual(of(lint(fileOf(303), [10, 11, 12], 3), RULES.oversizedGrew), []);
  assert.deepEqual(of(lint(fileOf(303), [10, 11, 12], 1), RULES.oversizedGrew).map((f) => f.data.after - f.data.before), [2]);
});

test('R40: a function already too long that certainly grew is reported; a replacement is not', () => {
  const grew = lint(fnOf(60), [30, 31]);
  assert.deepEqual(of(grew, RULES.functionTooLong), []);
  assert.deepEqual(of(grew, RULES.oversizedGrew).map((f) => [f.data.kind, f.data.name, f.line]), [['function', 'total', 1]]);
  // 2 líneas escritas y 2 borradas en el archivo: puede ser un reemplazo; no se cobra.
  assert.deepEqual(of(lint(fnOf(60), [30, 31], 2), RULES.oversizedGrew).filter((f) => f.data.kind === 'function'), []);
});

test('R40: something that was within the limit keeps reporting the size rule, not oversized-grew', () => {
  const found = lint(fileOf(320), Array.from({ length: 30 }, (_, i) => 10 + i));
  assert.equal(of(found, RULES.fileTooLong).length, 1);
  assert.deepEqual(of(found, RULES.oversizedGrew), []);
});

test('R40: without line information nothing changes (the whole file is reviewed as before)', () => {
  const found = lintSource(fileOf(303), { file: 'src/precio.ts', limits: LIMITS });
  assert.equal(of(found, RULES.fileTooLong).length, 1);
  assert.deepEqual(of(found, RULES.oversizedGrew), []);
});

test('R40: the rule has an explanatory message in Spanish and English', () => {
  const data = { kind: 'file', before: 301, after: 303, limit: 300 };
  const es = messageOf(RULES.oversizedGrew, data, 'es');
  const en = messageOf(RULES.oversizedGrew, data, 'en');
  assert.match(es, /301/);
  assert.match(en, /303/);
  assert.notEqual(es, en);
  assert.match(messageOf(RULES.oversizedGrew, { kind: 'function', name: 'total', before: 60, after: 62, limit: 40 }, 'en'), /"total"/);
});

test('R40: the function finding carries its sizes and the span of the function', () => {
  const [f] = of(lint(fnOf(60), [30, 31]), RULES.oversizedGrew);
  assert.deepEqual([f.data.before, f.data.after, f.data.limit], [60, 62, 40]);
  assert.equal(f.until, 62);
});
