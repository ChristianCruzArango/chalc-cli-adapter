// T2 (spec 019, R4 — lectura) — la bitácora lee lo que el revisor dice de cada requisito.
//
// En el E2E de la spec 017, T2 («exponer por HTTP») se cerró con el módulo sin conectar a la app: nadie
// comprobó el requisito. El revisor deja ahora una línea por cada `R#` de la tarea, y antes de exigirlas
// hay que poder leerlas, en los dos idiomas del spec y con las formas que escribe un modelo.

import test from 'node:test';
import assert from 'node:assert/strict';
import { allReviews } from '../catalog/next/lib/review.mjs';

const read = (body, verdict = 'OK') => allReviews(`## 2026-10-13T10:00:00Z · a1b2c3d4e5 · revisor · ${verdict}\n${body}`)[0];

test('R4: requirement lines are read in Spanish', () => {
  assert.deepEqual(read([
    '- R1: cumple — src/app.module.ts:7, src/app.saludo.spec.ts:6',
    '- R2: no cumple — src/saludo.controller.ts:12',
    '- R3: no aplica — la tarea no toca el saludo por defecto'
  ].join('\n')).requirements, {
    R1: { status: 'complies', refs: ['src/app.module.ts:7', 'src/app.saludo.spec.ts:6'] },
    R2: { status: 'violates', refs: ['src/saludo.controller.ts:12'] },
    R3: { status: 'na', reason: 'la tarea no toca el saludo por defecto' }
  });
});

test('R4: requirement lines are read in English', () => {
  assert.deepEqual(read(['- R1: complies — a.ts:1', '- R2: violates — b.ts:2', '- R3: n/a — out of this task scope'].join('\n')).requirements, {
    R1: { status: 'complies', refs: ['a.ts:1'] },
    R2: { status: 'violates', refs: ['b.ts:2'] },
    R3: { status: 'na', reason: 'out of this task scope' }
  });
});

test('R4: «no cumple» is never read as «cumple»', () => {
  assert.equal(read('- R1: no cumple — a.ts:1').requirements.R1.status, 'violates');
});

test('R4: case, bullets, spacing and separators are free; numbers have several digits', () => {
  const r = read(['  * r12:Cumple—a.ts:10', '-R3 : NO CUMPLE -- b.ts:2', '- R4: no aplica - ya no existe   '].join('\n')).requirements;
  assert.deepEqual(r.R12, { status: 'complies', refs: ['a.ts:10'] });
  assert.equal(r.R3.status, 'violates');
  assert.equal(r.R4.reason, 'ya no existe');
});

test('R4: what only looks like a requirement line is not one', () => {
  assert.deepEqual(read([
    '1. a.ts:1 — ver - R1: cumple — a.ts:1',
    'R2: cumple — sin viñeta',
    '- R: cumple — a.ts:1',
    '- R5: arreglado — a.ts:1',
    '- Regla a1b2c3d4: cumple — a.ts:1',
    '- A01 Control: revisado — a.ts:1'
  ].join('\n'), 'FINDINGS: 1').requirements, {});
});

test('R4: an entry without requirement lines has none', () => {
  assert.deepEqual(read('').requirements, {});
});

test('R4: the separator is optional, and a line without file:line keeps an empty list', () => {
  const r = read(['- R1: cumple src/a.ts:3', '- R2: cumple'].join('\n')).requirements;
  assert.deepEqual(r.R1, { status: 'complies', refs: ['src/a.ts:3'] });
  assert.deepEqual(r.R2, { status: 'complies', refs: [] });
});
