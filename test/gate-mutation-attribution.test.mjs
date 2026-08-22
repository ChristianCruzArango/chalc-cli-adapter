// El score de mutación se mide sobre lo que la tarea ESCRIBIÓ.
//
// Mutar el archivo entero mete en la cuenta los mutantes que ya vivían ahí. En una feature real,
// 132 de 139 supervivientes eran de código que la tarea no tocó: con ese denominador el umbral es
// inalcanzable en cualquier repo con historia, y el camino más corto para subirlo es escribir
// pruebas de relleno sobre código ajeno — justo lo contrario de lo que la regla persigue.

import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize } from '../catalog/gate/lib/mutants.mjs';
import { parseElements } from '../catalog/gate/lib/report-elements.mjs';

const mutante = (file, line, status) => ({ file, line, status, mutator: 'Arithmetic' });

test('summarize counts every mutant when nothing limits the scope', async () => {
  const r = summarize([
    mutante('src/a.ts', 10, 'Killed'),
    mutante('src/a.ts', 90, 'Survived')
  ]);

  assert.equal(r.total, 2);
  assert.equal(r.score, 50);
});

test('summarize ignores mutants outside the lines the task wrote', async () => {
  const within = (file, line) => file === 'src/a.ts' && line === 10;

  const r = summarize([
    mutante('src/a.ts', 10, 'Killed'),
    mutante('src/a.ts', 90, 'Survived'),      // deuda vieja del mismo archivo
    mutante('src/b.ts', 3, 'Survived')        // otro archivo que la tarea solo rozó
  ], { within });

  assert.equal(r.total, 1, 'solo cuenta el mutante de la línea escrita');
  assert.equal(r.score, 100);
  assert.deepEqual(r.survivors, []);
});

test('summarize keeps a survivor that does sit on a written line', async () => {
  const within = (file, line) => line === 90;

  const r = summarize([
    mutante('src/a.ts', 10, 'Killed'),
    mutante('src/a.ts', 90, 'Survived')
  ], { within });

  assert.equal(r.total, 1);
  assert.equal(r.score, 0);
  assert.equal(r.survivors.length, 1);
  assert.equal(r.survivors[0].line, 90);
});

// Sin ningún mutante dentro del alcance no hay base para un veredicto: `null` obliga al llamador a
// bloquear en vez de inventarse un 0 —que se leería como "pruebas malísimas"— o un 100.
test('summarize reports no score when the scope leaves no mutant', async () => {
  const r = summarize([mutante('src/a.ts', 90, 'Survived')], { within: () => false });

  assert.equal(r.score, null);
  assert.equal(r.total, 0);
});

test('parseElements forwards the scope to the summary', async () => {
  const report = JSON.stringify({
    schemaVersion: '1.0',
    files: {
      'src/a.ts': {
        mutants: [
          { id: '1', mutatorName: 'Arithmetic', location: { start: { line: 10 } }, status: 'Killed' },
          { id: '2', mutatorName: 'Arithmetic', location: { start: { line: 90 } }, status: 'Survived' }
        ]
      }
    }
  });

  const r = parseElements(report, { within: (file, line) => line === 10 });

  assert.equal(r.total, 1);
  assert.equal(r.score, 100);
});
