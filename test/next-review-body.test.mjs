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
