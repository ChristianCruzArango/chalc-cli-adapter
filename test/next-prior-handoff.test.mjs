// T12 (spec 017, R9) — el advisor le entrega al rol los hallazgos que tiene que volver a mirar.
//
// Exigir una línea por hallazgo previo (T11) solo es justo si el rol SABE cuáles son. El advisor ya le
// entrega las reglas de la memoria dentro del motivo (spec 015, R16); aquí le entrega también los
// hallazgos de su pasada anterior, con número y texto, sin romper el contrato de tres líneas.

import test from 'node:test';
import assert from 'node:assert/strict';
import { allReviews } from '../catalog/next/lib/review.mjs';
import { decide } from '../catalog/next/lib/decide.mjs';
import { reasonOf } from '../catalog/next/lib/i18n.mjs';
import { render } from '../catalog/next/next.mjs';

const GATE = Date.parse('2026-10-13T15:00:00Z');
const ROLES = [{ id: 'revisor', order: 10, cadence: 'task', required: true }];
const PRIOR = '## 2026-10-13T14:50:00Z · a1b2c3d4e5 · revisor · FINDINGS: 2\n1. src/tarifa.mjs:3 — redondeo a mano\n2. src/viejo.mjs:9 — nombre engañoso';
const ITEMS = [{ n: 1, text: 'src/tarifa.mjs:3 — redondeo a mano' }, { n: 2, text: 'src/viejo.mjs:9 — nombre engañoso' }];

const snap = ({ log = '', baseline = 0 } = {}) => ({
  tasks: { hasTasksFile: true, done: 1, total: 3, current: '**T2** (R2) — Calcular tarifas', mtime: GATE - 1 },
  gate: { exists: true, date: GATE, verdict: 'pass', fast: false, scopeHash: 'h', currentScopeHash: 'h', branch: 'b', pending: [] },
  review: { entries: allReviews(log) },
  changed: { files: ['src/tarifa.mjs'], newestMtime: GATE - 10 },
  flow: { approvals: { task: true, feature: true }, roles: ROLES },
  git: { isRepo: true, branch: 'b' },
  memory: { entries: [] },
  baseline: { date: baseline },
  problems: []
});

test('R9: calling a role again hands it the findings of its previous pass', () => {
  const result = decide(snap({ log: PRIOR }));
  assert.equal(result.action, 'call_role');
  assert.deepEqual(result.facts.prior, ITEMS);
});

test('R9: the reason lists them and says how to answer each one, in both languages', () => {
  const { facts } = decide(snap({ log: PRIOR }));
  const es = reasonOf('call_role', facts, 'es');
  assert.match(es, /Hallazgo <n>: corregido \| no corregido \| no aplica/);
  assert.match(es, /1\. src\/tarifa\.mjs:3 — redondeo a mano/);
  assert.match(es, /2\. src\/viejo\.mjs:9/);
  assert.match(es, /redondeo a mano; 2\. src\/viejo/, 'one finding after another, separated');
  const en = reasonOf('call_role', facts, 'en');
  assert.match(en, /Finding <n>: fixed \| not fixed \| n\/a/);
  assert.match(en, /1\. src\/tarifa\.mjs:3/);
});

test('R9: with findings still to fix, the reason already says they will be answered one by one', () => {
  const log = `${PRIOR.replace('14:50', '15:05')}`;
  const result = decide(snap({ log }));
  assert.equal(result.action, 'fix_review');
  assert.deepEqual(result.facts.prior, ITEMS);
  assert.match(reasonOf('fix_review', result.facts, 'es'), /Hallazgo <n>/);
  assert.match(reasonOf('fix_review', result.facts, 'en'), /Finding <n>/);
});

test('R9: without prior findings the reason does not change', () => {
  const { facts } = decide(snap());
  assert.deepEqual(facts.prior, []);
  assert.doesNotMatch(reasonOf('call_role', facts, 'es'), /Hallazgo/);
  assert.doesNotMatch(reasonOf('call_role', facts, 'en'), /Finding/);
});

test('R9: a baseline sealed after the findings does not hide them from the role', () => {
  const { facts } = decide(snap({ log: PRIOR, baseline: Date.parse('2026-10-13T14:55:00Z') }));
  assert.deepEqual(facts.prior, ITEMS);
});

test('R9: a long finding is shortened and the output keeps its three lines', () => {
  const long = PRIOR.replace('redondeo a mano', 'redondeo a mano '.repeat(20));
  const { facts } = decide(snap({ log: long }));
  const reason = reasonOf('call_role', facts, 'es');
  assert.match(reason, /…/);
  assert.equal(render({ action: 'call_role', reason, command: '' }).split('\n').length, 3);
});

test('R12 (018): up to 200 characters of each prior finding are handed over', () => {
  const text = 'x'.repeat(150);
  const { facts } = decide(snap({ log: `## 2026-10-13T14:50:00Z · a1b2c3d4e5 · revisor · FINDINGS: 1\n1. ${text}` }));
  assert.ok(reasonOf('call_role', facts, 'es').includes(text));
  const long = `${'palabra '.repeat(40)}fin`;
  const cut = decide(snap({ log: `## 2026-10-13T14:50:00Z · a1b2c3d4e5 · revisor · FINDINGS: 1\n1. ${long}` })).facts;
  const shown = reasonOf('call_role', cut, 'es').match(/1\. (palabra[^;]*?…)/)[1];
  assert.ok(shown.length <= 201 && shown.length > 150, String(shown.length));
});

test('R9: without prior findings the reason ends exactly where it always did', () => {
  const { facts } = decide(snap());
  assert.match(reasonOf('call_role', facts, 'es'), /por esta tarea\.$/);
  assert.match(reasonOf('call_role', facts, 'en'), /for this task\.$/);
});
