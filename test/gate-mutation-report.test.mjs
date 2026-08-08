// T9 (R3) — parser del reporte NATIVO de mutación, esquema mutation-testing-elements
// (el que escriben Stryker JS y Stryker.NET). El score y los sobrevivientes salen de ESTE archivo,
// nunca del stdout de la herramienta ni de un resumen escrito por un asistente.
//
// Regla de la spec: si el shape no encaja, el parser FALLA explícitamente. Devolver 0 sería peor que
// fallar — un 0 se lee como "tests malísimos" y un shape raro se lee como "reporte inservible".

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseElements } from '../catalog/gate/lib/report-elements.mjs';

// Reporte mínimo con el shape real: files → mutants → { mutatorName, location, status }.
const mutant = (id, status, line, mutator = 'ArithmeticOperator') => ({
  id: String(id),
  mutatorName: mutator,
  replacement: '-',
  location: { start: { line, column: 5 }, end: { line, column: 9 } },
  status
});

const report = (files) => JSON.stringify({ schemaVersion: '1.0', thresholds: { high: 80, low: 60 }, files });

test('parseElements derives the score from the report statuses', async () => {
  const text = report({
    'src/precio.ts': { language: 'typescript', source: '…', mutants: [mutant(1, 'Killed', 4), mutant(2, 'Timeout', 7)] },
    'src/total.ts': { language: 'typescript', source: '…', mutants: [mutant(3, 'Survived', 12), mutant(4, 'NoCoverage', 20)] }
  });

  const r = parseElements(text);

  // detectados = Killed + Timeout · no detectados = Survived + NoCoverage
  assert.equal(r.killed, 1);
  assert.equal(r.timeout, 1);
  assert.equal(r.survived, 1);
  assert.equal(r.noCoverage, 1);
  assert.equal(r.total, 4);
  assert.equal(r.score, 50);
});

test('parseElements lists survivors with file, line and mutator', async () => {
  const text = report({
    'src/total.ts': { mutants: [mutant(1, 'Killed', 3), mutant(2, 'Survived', 12, 'ConditionalExpression')] },
    'src/precio.ts': { mutants: [mutant(3, 'NoCoverage', 8, 'BooleanLiteral')] }
  });

  const r = parseElements(text);

  assert.equal(r.survivors.length, 2);
  // Ordenados por archivo y línea: el informe tiene que ser estable entre corridas.
  assert.deepEqual(r.survivors[0], { file: 'src/precio.ts', line: 8, mutator: 'BooleanLiteral', status: 'NoCoverage' });
  assert.deepEqual(r.survivors[1], { file: 'src/total.ts', line: 12, mutator: 'ConditionalExpression', status: 'Survived' });
});

// Un mutante que no compila o que la config ignora NO es un test flojo: contarlo hundiría el score
// y haría que el portón bloqueara por algo que no es culpa de las pruebas.
test('parseElements excludes ignored and non-compiling mutants from the score', async () => {
  const text = report({
    'src/x.ts': {
      mutants: [mutant(1, 'Killed', 1), mutant(2, 'Ignored', 2), mutant(3, 'CompileError', 3), mutant(4, 'RuntimeError', 4)]
    }
  });

  const r = parseElements(text);

  assert.equal(r.total, 1);
  assert.equal(r.score, 100);
  assert.deepEqual(r.survivors, []);
});

test('parseElements reads a Stryker.NET report with absolute file keys', async () => {
  const text = JSON.stringify({
    schemaVersion: '1.0',
    projectRoot: 'C:\\src\\Api',
    files: {
      'C:\\src\\Api\\Domain\\Precio.cs': { mutants: [mutant(1, 'Survived', 42, 'Arithmetic')] }
    }
  });

  const r = parseElements(text);

  assert.equal(r.score, 0);
  assert.equal(r.survivors[0].line, 42);
  assert.match(r.survivors[0].file, /Precio\.cs$/);
});

test('parseElements throws on invalid JSON instead of reporting a zero score', async () => {
  assert.throws(() => parseElements('{ esto no es json'), /report/i);
});

test('parseElements throws when the shape does not match the schema', async () => {
  assert.throws(() => parseElements(JSON.stringify({ resumen: 'todo bien, score 92%' })), /files/i);
});

// Sin mutantes válidos no hay score: `null` obliga al llamador a tratarlo como bloqueo (R4),
// mientras que un 0 o un 100 inventados se colarían como veredicto.
test('parseElements returns a null score when there is no valid mutant', async () => {
  const r = parseElements(report({ 'src/x.ts': { mutants: [mutant(1, 'Ignored', 1)] } }));

  assert.equal(r.score, null);
  assert.equal(r.total, 0);
});
