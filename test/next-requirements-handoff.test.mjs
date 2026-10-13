// T4 (spec 019, R4) — el advisor le entrega al revisor los requisitos que tiene que responder.
//
// Exigir una línea por `R#` (T3) solo es justo si el rol sabe cuáles son. Igual que los hallazgos previos
// (spec 017, R9), van dentro del motivo, con la forma exacta de responder, y solo para el rol cuyo contrato
// declara la checklist de requisitos.

import test from 'node:test';
import assert from 'node:assert/strict';
import { allReviews } from '../catalog/next/lib/review.mjs';
import { decide } from '../catalog/next/lib/decide.mjs';
import { reasonOf } from '../catalog/next/lib/i18n.mjs';

const GATE = Date.parse('2026-10-13T15:00:00Z');
const ROLES = [
  { id: 'seguridad', order: 5, cadence: 'task', required: true, checklist: 'owasp' },
  { id: 'revisor', order: 10, cadence: 'task', required: true, checklist: 'requirements' }
];
const OWASP = ['A01', 'A02', 'A03', 'A04', 'A05', 'A06', 'A07', 'A08', 'A09', 'A10'].map((id) => `- ${id} X: no aplica — la tarea no toca esto`).join('\n');
const snap = (log, current = '**T2** (R1, R3) — Exponer por HTTP') => ({
  tasks: { hasTasksFile: true, done: 1, total: 3, current, mtime: GATE - 1 },
  gate: { exists: true, date: GATE, verdict: 'pass', fast: false, scopeHash: 'h', currentScopeHash: 'h', branch: 'b', pending: [] },
  review: { entries: allReviews(log) },
  changed: { files: ['src/a.ts'], newestMtime: GATE - 10 },
  flow: { approvals: { task: true, feature: true }, roles: ROLES },
  git: { isRepo: true, branch: 'b' },
  problems: []
});
const SEGURIDAD_OK = `## 2026-10-13T15:05:00Z · a1b2c3d4e5 · seguridad · OK\n${OWASP}`;

test('R4: calling the reviewer hands it the requirements of the task and how to answer each', () => {
  const result = decide(snap(SEGURIDAD_OK));
  assert.deepEqual([result.action, result.facts.role, result.facts.requirements], ['call_role', 'revisor', ['R1', 'R3']]);
  assert.match(reasonOf('call_role', result.facts, 'es'), /Revisa requisito por requisito \(R1, R3\).*- R<n>: cumple \| no cumple \| no aplica/);
  assert.match(reasonOf('call_role', result.facts, 'en'), /Review requirement by requirement \(R1, R3\).*- R<n>: complies \| violates \| n\/a/);
});

test('R4: with findings to fix, the reason also reminds the requirements', () => {
  // Una entrada con hallazgos también responde cada requisito (T3): si no, el advisor la devolvería a una persona.
  const log = `${SEGURIDAD_OK}\n## 2026-10-13T15:06:00Z · a1b2c3d4e5 · revisor · FINDINGS: 1\n- R1: no cumple — src/a.ts:1\n- R3: cumple — src/a.ts:2\n1. src/a.ts:1 — [spec] falta`;
  const result = decide(snap(log));
  assert.equal(result.action, 'fix_review');
  assert.match(reasonOf('fix_review', result.facts, 'es'), /R1, R3/);
});

test('R4: a role without the requirements checklist is not asked for them', () => {
  const result = decide(snap(''));
  assert.deepEqual([result.facts.role, result.facts.requirements], ['seguridad', []]);
  assert.doesNotMatch(reasonOf('call_role', result.facts, 'es'), /requisito por requisito/);
});

test('R6: a task without requirements hands none, and the reason does not change', () => {
  const result = decide(snap(SEGURIDAD_OK, '**T3** — Mutation testing'));
  assert.deepEqual(result.facts.requirements, []);
  assert.match(reasonOf('call_role', result.facts, 'es'), /por esta tarea\.$/);
});
