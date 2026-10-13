// T1 (spec 018, R9) — el advisor valida la checklist contra el alcance que se MIDIÓ.
//
// Encontrado en el E2E de la spec 017: tras un commit entre tareas, el portón midió (y escribió en
// «Alcance de la tarea») un alcance desde la base vieja, y al aprobar re-selló la base. El advisor validó
// la checklist contra el alcance vivo —ya sin los archivos de la tarea anterior— y un rol que citó un
// archivo que la propia evidencia le dio como alcance terminó en `ask_human`. Mientras la evidencia esté
// vigente, el alcance es el suyo: es el que se le entregó al rol.

import test from 'node:test';
import assert from 'node:assert/strict';
import { allReviews } from '../catalog/next/lib/review.mjs';
import { decide } from '../catalog/next/lib/decide.mjs';

const GATE = Date.parse('2026-10-13T18:21:00Z');
const OWASP = ['A01', 'A02', 'A03', 'A04', 'A05', 'A06', 'A07', 'A08', 'A09', 'A10'];
const ROLES = [{ id: 'seguridad', order: 5, cadence: 'task', required: true, checklist: 'owasp' }];
const MEASURED = ['src/saludo.controller.ts', 'src/saludo.service.ts'];
const LIVE = ['src/saludo.controller.ts'];

// Una checklist que cita, en A09, un archivo que la evidencia midió pero que ya no está en el alcance vivo.
const entry = (a09 = 'src/saludo.service.ts:5') => [
  '## 2026-10-13T18:22:12Z · 148e4867d7 · seguridad · OK',
  ...OWASP.map((id) => (id === 'A09'
    ? `- A09 Registro: revisado — ${a09}`
    : `- ${id} Categoría: revisado — src/saludo.controller.ts:9`))
].join('\n');

const snap = ({ log = entry(), scopeFiles = MEASURED, currentScopeHash = 'h', changed = LIVE } = {}) => ({
  tasks: { hasTasksFile: true, done: 1, total: 2, current: 'T2 — exponer por HTTP', mtime: GATE - 1 },
  gate: { exists: true, date: GATE, verdict: 'pass', fast: false, scopeHash: 'h', currentScopeHash, scopeFiles, branch: 'b', pending: [] },
  review: { entries: allReviews(log) },
  changed: { files: changed, newestMtime: GATE - 10 },
  flow: { approvals: { task: true, feature: true }, roles: ROLES },
  git: { isRepo: true, branch: 'b' },
  platform: { mobile: false },
  problems: []
});

test('R9: with current evidence, a file the evidence measured counts as in scope', () => {
  assert.equal(decide(snap()).action, 'tick_task');
});

test('R9: a file outside what was measured is still not in scope', () => {
  const result = decide(snap({ log: entry('src/otro.ts:1') }));
  assert.equal(result.action, 'ask_human');
  assert.ok(result.facts.problems.some((p) => /A09: reviewed without file:line from the task/.test(p)), JSON.stringify(result.facts));
});

test('R9: evidence that no longer matches the code falls back to the live scope', () => {
  const result = decide(snap({ currentScopeHash: 'otro' }));
  assert.equal(result.action, 'ask_human');
});

test('R9: evidence without a recorded scope falls back to the live scope', () => {
  assert.equal(decide(snap({ scopeFiles: [] })).action, 'ask_human');
  assert.equal(decide(snap({ scopeFiles: [], changed: MEASURED })).action, 'tick_task');
});

test('R9: without a live scope and without a measured one, nothing is in scope', () => {
  const s = snap({ scopeFiles: [] });
  delete s.changed.files;
  assert.equal(decide(s).action, 'ask_human');
});
