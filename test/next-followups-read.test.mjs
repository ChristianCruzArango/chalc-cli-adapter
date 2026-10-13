// T9 (spec 017, R10 — lectura) — la bitácora lee los hallazgos y lo que se dice de los anteriores.
//
// Para que un rol no pueda «olvidar» un hallazgo suyo entre dos pasadas, primero hay que poder leer
// dos cosas que hoy solo se cuentan o se ignoran: el TEXTO de cada punto numerado (los hallazgos que
// se entregarán a la pasada siguiente) y las líneas `Hallazgo <n>: corregido | no corregido | no aplica`
// con las que esa pasada responde. Las escribe un modelo: el lector acepta las formas razonables, en
// los dos idiomas del spec, y no se inventa una respuesta donde no la hay.

import test from 'node:test';
import assert from 'node:assert/strict';
import { allReviews } from '../catalog/next/lib/review.mjs';

const HEAD = '## 2026-10-13T10:00:00Z · a1b2c3d4e5 · revisor';
const read = (body, verdict = 'OK') => allReviews(`${HEAD} · ${verdict}\n${body}`)[0];

test('R10: each numbered finding is read with its number and its text', () => {
  const entry = read('1. lib/a.js:3 — dos interfaces en un archivo\n  2. lib/b.js:9 — nombre engañoso', 'FINDINGS: 2');
  assert.deepEqual(entry.items, [
    { n: 1, text: 'lib/a.js:3 — dos interfaces en un archivo' },
    { n: 2, text: 'lib/b.js:9 — nombre engañoso' }
  ]);
  assert.equal(entry.numbered, 2);
});

test('R10: a number in the middle of a line is not a finding', () => {
  assert.deepEqual(read('ver el punto 2. de arriba').items, []);
});

test('R10: an entry without findings has no items and no follow-ups', () => {
  const entry = read('');
  assert.deepEqual(entry.items, []);
  assert.deepEqual(entry.followups, {});
});

test('R10: follow-ups are read in Spanish', () => {
  const entry = read([
    '- Hallazgo 1: corregido — lib/a.js:4',
    '- Hallazgo 2: no corregido — lib/b.js:9, lib/c.js:1',
    '- Hallazgo 3: no aplica — el archivo se borró en esta tarea'
  ].join('\n'));
  assert.deepEqual(entry.followups, {
    1: { status: 'fixed', refs: ['lib/a.js:4'] },
    2: { status: 'not-fixed', refs: ['lib/b.js:9', 'lib/c.js:1'] },
    3: { status: 'na', reason: 'el archivo se borró en esta tarea' }
  });
});

test('R10: follow-ups are read in English', () => {
  const entry = read([
    '- Finding 1: fixed — lib/a.js:4',
    '- Finding 2: not fixed — lib/b.js:9',
    '- Finding 3: n/a — the file was deleted in this task'
  ].join('\n'));
  assert.deepEqual(entry.followups, {
    1: { status: 'fixed', refs: ['lib/a.js:4'] },
    2: { status: 'not-fixed', refs: ['lib/b.js:9'] },
    3: { status: 'na', reason: 'the file was deleted in this task' }
  });
});

// El orden de las alternativas importa: «no corregido» contiene «corregido». Leerlo al revés daría por
// corregido justo el hallazgo que sigue abierto.
test('R10: «no corregido» and «not fixed» are never read as fixed', () => {
  assert.equal(read('- Hallazgo 1: no corregido — a.js:1').followups[1].status, 'not-fixed');
  assert.equal(read('- Finding 1: not fixed — a.js:1').followups[1].status, 'not-fixed');
});

test('R10: indentation, other bullets, case and separators are accepted', () => {
  const entry = read([
    '  * HALLAZGO 1:Corregido—a.js:1',
    '- finding 2: Fixed -- b.js:2',
    '- Hallazgo 3: no aplica - ya no existe ese código'
  ].join('\n'));
  assert.deepEqual(entry.followups[1], { status: 'fixed', refs: ['a.js:1'] });
  assert.deepEqual(entry.followups[2], { status: 'fixed', refs: ['b.js:2'] });
  assert.deepEqual(entry.followups[3], { status: 'na', reason: 'ya no existe ese código' });
});

test('R10: a follow-up without file:line keeps an empty list of refs', () => {
  assert.deepEqual(read('- Hallazgo 1: corregido').followups[1], { status: 'fixed', refs: [] });
});

test('R10: text that only looks like a follow-up is not one', () => {
  const entry = read([
    '1. a.js:1 — ver - Hallazgo 2: corregido — b.js:1',
    'Hallazgo 3: corregido — sin viñeta',
    '- Hallazgo x: corregido — a.js:1',
    '- Hallazgo 4: arreglado — a.js:1'
  ].join('\n'), 'FINDINGS: 1');
  assert.deepEqual(entry.followups, {});
});

// Los casos de abajo salen de la pasada de mutación: formas que un modelo escribe y que ningún caso
// anterior distinguía.

test('R10: numbers and line numbers with several digits are read whole', () => {
  const entry = read('- Hallazgo 12: corregido — lib/a.js:120');
  assert.deepEqual(entry.followups[12], { status: 'fixed', refs: ['lib/a.js:120'] });
});

test('R10: spacing around the bullet, the number and the colon is free', () => {
  const entry = read([
    '-Hallazgo 1: corregido — a.js:1',
    '-   Hallazgo 2: corregido — a.js:2',
    '- Hallazgo   3: corregido — a.js:3',
    '- Hallazgo 4 : corregido — a.js:4'
  ].join('\n'));
  assert.deepEqual(Object.keys(entry.followups), ['1', '2', '3', '4']);
});

test('R10: the text of a finding has no leading or trailing spaces', () => {
  assert.deepEqual(read('1.   a.js:1 — algo   ', 'FINDINGS: 1').items, [{ n: 1, text: 'a.js:1 — algo' }]);
});

test('R10: the reason of «no aplica» is kept without trailing spaces', () => {
  assert.equal(read('- Hallazgo 1: no aplica — el código ya no existe   ').followups[1].reason, 'el código ya no existe');
});

// T4 (spec 018, R12): en el E2E, el hallazgo real de `seguridad` ocupaba siete líneas y el advisor solo
// entregaba la primera («… — A03, `xss.md`»): el rol no sabía qué tenía que volver a mirar.

test('R12 (018): the indented lines that follow a finding are part of its text', () => {
  const entry = read([
    '1. src/saludo.controller.ts:9-10 — A03 (XSS reflejado):',
    '   el controlador devuelve un string que se envía como text/html;',
    '   `?nombre=<script>` se ejecuta en el navegador.',
    '2. src/saludo.module.ts:6 — módulo sin importar'
  ].join('\n'), 'FINDINGS: 2');
  assert.deepEqual(entry.items, [
    { n: 1, text: 'src/saludo.controller.ts:9-10 — A03 (XSS reflejado): el controlador devuelve un string que se envía como text/html; `?nombre=<script>` se ejecuta en el navegador.' },
    { n: 2, text: 'src/saludo.module.ts:6 — módulo sin importar' }
  ]);
  assert.equal(entry.numbered, 2);
});

test('R12 (018): a blank line, a bullet or an unindented line ends the finding', () => {
  const entry = read([
    '1. a.js:1 — uno',
    '',
    '   esto ya no es del hallazgo',
    '2. b.js:2 — dos',
    '- Regla a1b2c3d4: cumple — b.js:2',
    '3. c.js:3 — tres',
    'texto suelto sin sangría'
  ].join('\n'), 'FINDINGS: 3');
  assert.deepEqual(entry.items.map((i) => i.text), ['a.js:1 — uno', 'b.js:2 — dos', 'c.js:3 — tres']);
});

test('R12 (018): an indented checklist or follow-up line is never part of a finding', () => {
  const entry = read(['1. a.js:1 — uno', '  -A02 Cripto: no aplica — la tarea no cifra', '  * Hallazgo 1: corregido — a.js:1'].join('\n'), 'FINDINGS: 1');
  assert.equal(entry.items[0].text, 'a.js:1 — uno');
  assert.equal(entry.checklist.A02.status, 'na');
});
