// T19 (spec 020, R18) — las notas de cada rol, tal como las dejó.
//
// El parser del advisor (`allReviews`) se queda con lo que necesita para decidir —estados y `archivo:línea`— y
// tira el resto: la explicación que el rol escribe entre paréntesis, que es justo lo que una persona quiere leer.
// El tablero lee la bitácora por su cuenta, entrada por entrada, y conserva cada línea entera con su marca.
// Lo que pinta es texto del repo: se muestra como texto, nunca como HTML.

import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_NOTES, reviewNotes, taskAt } from '../catalog/live/lib/notes.mjs';

const LOG = [
  '# Bitácora de revisiones',
  '',
  '## 2026-10-13T23:10:36Z · dc7e13bd88 · revisor · FINDINGS: 2',
  '1. [spec] src/app.module.ts:7 — el módulo no se importa',
  '2. [calidad] src/saludo.ts:3 — nombre poco claro',
  '- R1: no cumple — src/app.module.ts:7 (el endpoint no es alcanzable)',
  '- R2: no aplica — se cubre en T2',
  '',
  '## 2026-10-13T23:14:11Z · dc7e13bd88 · revisor · OK',
  '- R1: cumple — src/app.module.ts:7 (SaludoModule importado)',
  '- Hallazgo 1: corregido — src/app.module.ts:7',
  '- Hallazgo 2: no corregido — se deja para otra feature',
  'Una línea suelta de explicación.',
  '## 2026-10-13T23:14:28Z · dc7e13bd88 · seguridad · OK',
  '- A01 Control de acceso: revisado — src/x.ts:4 (público)',
  '- A02 Criptografía: no aplica — no cifra nada',
  '- Regla M3: complies — src/x.ts:2',
  '- R9: violates — src/y.ts:1',
  '- Finding 3: fixed — src/x.ts:9',
  '- Finding 4: not fixed — later',
  '- A06: reviewed — src/x.ts:1',
  '- A07: n/a — no sessions'
].join('\n');

test('R18: each entry keeps its header (date, commit, role, verdict, findings), newest first', () => {
  const notes = reviewNotes(LOG);
  assert.deepEqual(notes.map((n) => [n.at, n.commit, n.role, n.ok, n.findings]), [
    ['2026-10-13T23:14:28.000Z', 'dc7e13bd88', 'seguridad', true, 0],
    ['2026-10-13T23:14:11.000Z', 'dc7e13bd88', 'revisor', true, 0],
    ['2026-10-13T23:10:36.000Z', 'dc7e13bd88', 'revisor', false, 2]
  ]);
});

test('R18: every line of the note is kept whole, with the explanation the advisor drops', () => {
  const [, second, first] = reviewNotes(LOG);
  assert.deepEqual(first.lines.map((l) => l.text), [
    '1. [spec] src/app.module.ts:7 — el módulo no se importa',
    '2. [calidad] src/saludo.ts:3 — nombre poco claro',
    'R1: no cumple — src/app.module.ts:7 (el endpoint no es alcanzable)',
    'R2: no aplica — se cubre en T2'
  ]);
  assert.equal(second.lines.at(-1).text, 'Una línea suelta de explicación.');
});

test('R18: each line carries its mark, in Spanish and in English', () => {
  const marks = reviewNotes(LOG).reverse().flatMap((n) => n.lines.map((l) => l.mark));
  assert.deepEqual(marks, [
    'finding', 'finding', 'violates', 'na',
    'complies', 'fixed', 'not-fixed', 'note',
    'reviewed', 'na', 'complies', 'violates', 'fixed', 'not-fixed', 'reviewed', 'na'
  ]);
});

test('R18: text before the first entry, blank lines and broken headers are not notes', () => {
  assert.deepEqual(reviewNotes(''), []);
  assert.deepEqual(reviewNotes(undefined), []);
  assert.deepEqual(reviewNotes('# solo título\n\ntexto'), []);
  const odd = reviewNotes('## no es una cabecera\n- R1: cumple — a.ts:1\n## 2026-10-13T10:00:00Z · abc1234 · revisor · OK\n- R1: cumple — a.ts:1');
  assert.equal(odd.length, 1);
  assert.equal(odd[0].lines.length, 1);
});

test('R18: a header the advisor would not read is not an entry here either (same grammar)', () => {
  const notes = reviewNotes('## 2026-10-13T10:00:00Z · abc1234 · revisor · FINDINGS\n1. uno\n## 2026-10-13T10:01:00Z · abc1234 · revisor · FINDINGS: 1\n1. dos');
  assert.deepEqual(notes.map((n) => [n.findings, n.lines.map((l) => l.text)]), [[1, ['1. dos']]]);
});

test('R18: the newest notes come first, and only the last ones are kept', () => {
  const at = (i) => new Date(Date.parse('2026-10-13T10:00:00Z') + i * 60_000).toISOString();
  const many = Array.from({ length: MAX_NOTES + 3 }, (_, i) => `## ${at(i).replace('.000Z', 'Z')} · abc1234 · revisor · OK`).join('\n');
  const notes = reviewNotes(many);
  assert.equal(MAX_NOTES, 60);
  assert.equal(notes.length, MAX_NOTES);
  assert.equal(notes[0].at, at(MAX_NOTES + 2));
  assert.equal(notes.at(-1).at, at(3));
});

test('R18: the task of a note is the one in progress when the role reviewed (none, if there was none)', () => {
  const activity = [
    { at: '2026-10-13T23:14:30.000Z', who: 'revisor', task: 'T3' },
    { at: '2026-10-13T23:14:00.000Z', who: 'revisor', task: 'T2' },
    { at: '2026-10-13T23:13:00.000Z', who: 'principal', task: '' },
    { at: '2026-10-13T23:10:00.000Z', who: 'principal', task: 'T1' }
  ];
  assert.equal(taskAt('2026-10-13T23:14:11.000Z', activity), 'T2');
  // Tras marcar la última tarea no hay tarea en curso: una nota de feature (el endurecedor) no es de ninguna.
  assert.equal(taskAt('2026-10-13T23:13:30.000Z', activity), '');
  assert.equal(taskAt('2026-10-13T23:09:00.000Z', activity), '');
  assert.equal(taskAt('2026-10-13T23:14:11.000Z', []), '');
});

// Los casos de abajo salen de la pasada de mutación.

test('R18: a status word inside the explanation is not the mark; only the status after the colon counts', () => {
  const [entry] = reviewNotes([
    '## 2026-10-13T10:00:00Z · abc1234 · revisor · OK',
    '- Nota: el endpoint casi no cumple con nada',
    '- Nota: ver si fue corregido',
    '- Nota: revisar 3. punto',
    'Ver 3. punto aparte',
    '- R1:cumple — a.ts:1',
    '10. [spec] a.ts:2 — dos cifras'
  ].join('\n'));
  assert.deepEqual(entry.lines.map((l) => l.mark), ['note', 'note', 'note', 'note', 'complies', 'finding']);
});

test('R18: indentation, a double space after the dash and inner dashes are handled', () => {
  const [entry] = reviewNotes([
    '   ## 2026-10-13T10:00:00Z · abc1234 · revisor · OK',
    '   - R1: cumple — a.ts:1',
    '-  R2: no aplica — b',
    'R3: cumple — src/a-b.ts:1 - con guion'
  ].join('\n'));
  assert.deepEqual(entry.lines.map((l) => l.text), ['R1: cumple — a.ts:1', 'R2: no aplica — b', 'R3: cumple — src/a-b.ts:1 - con guion']);
});

test('R18: lines after an unknown «##» heading do not join the previous entry', () => {
  const [entry] = reviewNotes(['## 2026-10-13T10:00:00Z · abc1234 · revisor · OK', '- R1: cumple — a.ts:1', '## Otra sección', '- suelta'].join('\n'));
  assert.deepEqual(entry.lines.map((l) => l.text), ['R1: cumple — a.ts:1']);
});

test('R18: an action at the very second of the review counts for its task', () => {
  assert.equal(taskAt('2026-10-13T23:14:00.000Z', [{ at: '2026-10-13T23:14:00.000Z', task: 'T2' }]), 'T2');
});
