// T10 (spec 017, R8) — qué hallazgos previos le tocan a una entrada nueva de la bitácora.
//
// Cada entrada de un rol responde a la ANTERIOR del mismo rol: si aquella dejó `FINDINGS: n`, esos n
// son los hallazgos que esta tiene que cerrar uno por uno; si aquella fue `OK`, no hay nada pendiente.
// No hace falta cortar por la línea base: una tarea solo cierra con `OK` de cada rol, así que lo de una
// tarea cerrada no se arrastra. Y cortar era peligroso: el portón vuelve a sellar la base a mitad de una
// tarea (ver next-followups-enforce.test.mjs).

import test from 'node:test';
import assert from 'node:assert/strict';
import { allReviews } from '../catalog/next/lib/review.mjs';
import { priorFindings } from '../catalog/next/lib/prior.mjs';

const at = (minute) => `2026-10-13T10:${String(minute).padStart(2, '0')}:00Z`;
const entry = (minute, role, verdict, body = '') => `## ${at(minute)} · a1b2c3d4e5 · ${role} · ${verdict}\n${body}`;
const log = (...entries) => allReviews(entries.join('\n'));
const last = (entries) => entries.at(-1);

test('R8: the findings of the previous entry of the same role are the prior findings', () => {
  const entries = log(
    entry(1, 'revisor', 'FINDINGS: 2', '1. a.js:1 — uno\n2. b.js:2 — dos'),
    entry(2, 'revisor', 'OK')
  );
  assert.deepEqual(priorFindings(entries, last(entries)), [{ n: 1, text: 'a.js:1 — uno' }, { n: 2, text: 'b.js:2 — dos' }]);
});

test('R8: after an OK of the same role there is nothing pending', () => {
  const entries = log(
    entry(1, 'revisor', 'FINDINGS: 1', '1. a.js:1 — uno'),
    entry(2, 'revisor', 'OK'),
    entry(3, 'revisor', 'OK')
  );
  assert.deepEqual(priorFindings(entries, last(entries)), []);
});

test('R8: only the immediately previous entry counts, not older findings', () => {
  const entries = log(
    entry(1, 'revisor', 'FINDINGS: 1', '1. viejo.js:1 — viejo'),
    entry(2, 'revisor', 'FINDINGS: 1', '1. nuevo.js:1 — nuevo'),
    entry(3, 'revisor', 'OK')
  );
  assert.deepEqual(priorFindings(entries, last(entries)), [{ n: 1, text: 'nuevo.js:1 — nuevo' }]);
});

test('R8: entries of other roles are not prior findings', () => {
  const entries = log(
    entry(1, 'seguridad', 'FINDINGS: 1', '1. a.js:1 — inyección'),
    entry(2, 'revisor', 'OK')
  );
  assert.deepEqual(priorFindings(entries, last(entries)), []);
});

test('R8: another role in between does not hide the previous entry of the same role', () => {
  const entries = log(
    entry(1, 'revisor', 'FINDINGS: 1', '1. a.js:1 — uno'),
    entry(2, 'seguridad', 'OK'),
    entry(3, 'revisor', 'OK')
  );
  assert.deepEqual(priorFindings(entries, last(entries)), [{ n: 1, text: 'a.js:1 — uno' }]);
});

test('R8: the first entry of a role has no prior findings', () => {
  const entries = log(entry(1, 'revisor', 'OK'));
  assert.deepEqual(priorFindings(entries, last(entries)), []);
});

test('R8: an entry is never its own prior, nor is a later one', () => {
  const entries = log(
    entry(1, 'revisor', 'OK'),
    entry(2, 'revisor', 'FINDINGS: 1', '1. a.js:1 — uno')
  );
  assert.deepEqual(priorFindings(entries, entries[0]), []);
  assert.deepEqual(priorFindings(entries, entries[1]), []);
});

test('R8: without an entry there is nothing to answer', () => {
  assert.deepEqual(priorFindings([], undefined), []);
  assert.deepEqual(priorFindings(undefined, null), []);
  assert.deepEqual(priorFindings(log(entry(1, 'revisor', 'FINDINGS: 1', '1. a.js:1 — uno')), undefined), []);
  assert.deepEqual(priorFindings(undefined, log(entry(1, 'revisor', 'OK'))[0]), []);
});
