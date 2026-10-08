// spec 014 · Tm (R28, R29) — los bordes del lector del cuerpo de la bitácora.
//
// La checklist la escribe un modelo, y un modelo sangra, junta palabras y mete `##` donde no toca.
// El lector tiene que entender las formas razonables y no inventarse una checklist donde no la hay.

import test from 'node:test';
import assert from 'node:assert/strict';
import { allReviews } from '../catalog/next/lib/review.mjs';

const HEAD = '## 2026-10-07T15:04:02Z · a1b2c3d4e5 · seguridad';
const read = (body, verdict = 'OK') => allReviews(`${HEAD} · ${verdict}\n${body}`)[0];

test('R28: indented lines and missing spaces are still checklist lines', () => {
  const entry = read([
    '  - A01 Control: revisado — lib/a.dart:1',
    '-A02 Cripto:no aplica—la tarea no cifra',
    '* A03 Inyección:  revisado  —  lib/a.dart:2'
  ].join('\n'));

  assert.deepEqual(entry.checklist.A01, { status: 'reviewed', refs: ['lib/a.dart:1'] });
  assert.deepEqual(entry.checklist.A02, { status: 'na', reason: 'la tarea no cifra' });
  assert.deepEqual(entry.checklist.A03, { status: 'reviewed', refs: ['lib/a.dart:2'] });
});

test('R28: the reason of «not applicable» is kept without trailing spaces', () => {
  assert.equal(read('- A02 Cripto: no aplica — la tarea no cifra   ').checklist.A02.reason, 'la tarea no cifra');
});

// Una línea de checklist dentro de un hallazgo no es la checklist: lo sería solo si empieza la línea.
test('R28: a checklist-like text inside a finding is not a checklist line', () => {
  const entry = read('1. lib/a.dart:3 — ver - A02 Cripto: no aplica — porque no hay nada', 'FINDINGS: 1');
  assert.equal(entry.checklist.A02, undefined);
});

test('R29: numbered items count when indented or above nine, and only at the start of a line', () => {
  const items = Array.from({ length: 10 }, (_, i) => `${i === 0 ? '  ' : ''}${i + 1}. lib/a.dart:${i + 1} — hallazgo`);
  const entry = read([...items, 'ver el punto 2. de arriba'].join('\n'), 'FINDINGS: 10');
  assert.equal(entry.numbered, 10);
});

// Un `##` en medio de una línea es texto, no el encabezado de otra entrada.
test('R29: a ## in the middle of a line does not start a new entry', () => {
  const entry = read('- A01 Control: revisado — lib/a.dart:1 ## visto con calma\n- A02 Cripto: no aplica — la tarea no cifra');
  assert.ok(entry.checklist.A02, 'la segunda línea sigue siendo de la misma entrada');
});

test('R29: a malformed heading is skipped, not returned as an empty entry', () => {
  const entries = allReviews('## esto no es un encabezado válido\n- A01 X: revisado — a.dart:1\n' + `${HEAD} · OK\n`);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].role, 'seguridad');
});

test('R11: learned rules are read with or without a dash, and their synonyms trimmed', () => {
  const entry = read([
    'Regla aprendida (dinero): Redondear',
    '- Learned rule (fechas; Synonyms:  vencimiento ,  , plazo ): Usar UTC',
    '* Regla aprendida (archivos; sinonimos: adjunto): Limitar tamaño'
  ].join('\n'));
  assert.deepEqual(entry.learned.map((l) => [l.concept, l.synonyms, l.text]), [
    ['dinero', [], 'Redondear'], ['fechas', ['vencimiento', 'plazo'], 'Usar UTC'], ['archivos', ['adjunto'], 'Limitar tamaño']
  ]);
});

test('R17: confirmations are read in both languages and with any separator', () => {
  const entry = read([
    '- Regla a1b2c3d4: CUMPLE -- src/a.mjs:3',
    '- Rule b1b2c3d4: violates - src/b.mjs:9',
    '- Regla c1b2c3d4: no cumple — src/c.mjs:1',
    '* Rule d1b2c3d4: n/a — the task shows no money',
    '- Regla e1b2c3d4a: cumple — src/a.mjs:3'
  ].join('\n'));
  assert.deepEqual(entry.confirmations.a1b2c3d4, { id: 'a1b2c3d4', status: 'complies', refs: ['src/a.mjs:3'] });
  assert.equal(entry.confirmations.b1b2c3d4.status, 'violates');
  assert.equal(entry.confirmations.c1b2c3d4.status, 'violates');
  assert.deepEqual(entry.confirmations.d1b2c3d4, { id: 'd1b2c3d4', status: 'na', reason: 'the task shows no money' });
  assert.equal(entry.confirmations.e1b2c3d4, undefined, 'un id de nueve caracteres no es un id');
});

test('R11: a learned rule is read only at the start of a line, with flexible spacing', () => {
  const entry = read([
    'Regla aprendida(dinero):Redondear',
    '   Learned rule  ( fechas ;synonyms:plazo ) :  Usar UTC  ',
    'ver la Regla aprendida (archivos): no es una regla'
  ].join('\n'));
  assert.deepEqual(entry.learned.map((l) => [l.concept, l.synonyms, l.text]), [['dinero', [], 'Redondear'], ['fechas', ['plazo'], 'Usar UTC']]);
});

test('R17: a confirmation is read only at the start of a line, with flexible spacing, and keeps whole refs', () => {
  const entry = read([
    '-Regla  a1b2c3d4 :cumple—src/a.mjs:123',
    '   *  Rule b1b2c3d4:   n/a —   la tarea no muestra montos   ',
    'ver - Regla c1b2c3d4: cumple — src/c.mjs:1'
  ].join('\n'));
  assert.deepEqual(entry.confirmations.a1b2c3d4.refs, ['src/a.mjs:123']);
  assert.equal(entry.confirmations.b1b2c3d4.reason, 'la tarea no muestra montos');
  assert.equal(entry.confirmations.c1b2c3d4, undefined);
});
