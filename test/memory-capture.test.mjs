// spec 015 · T5, T6 (R11–R13) — la memoria se llena sola al cerrar una tarea.
//
// chalc no le pide al modelo que guarde nada: lee lo que el ciclo ya dejó escrito. Las reglas
// aprendidas salen de las entradas de los roles en `.chalc/review.md`; las decisiones, de las
// supresiones que el portón aceptó. Y cada captura lee solo lo nuevo desde la anterior: capturar dos
// veces lo mismo sumaría una «vez vista» que no ocurrió.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { allReviews } from '../catalog/next/lib/review.mjs';
import { parseGateState } from '../catalog/next/lib/state.mjs';
import { renderState } from '../catalog/gate/lib/evidence.mjs';
import { capture } from '../catalog/memory/lib/capture.mjs';
import { readMemory } from '../catalog/memory/lib/store.mjs';
import { loadConcepts, conceptsIn } from '../catalog/memory/lib/concepts.mjs';

const ENTRY = (date, role, body) => `## ${date} · a1b2c3d4e5 · ${role} · OK\n${body}\n`;

// ── el lector de la bitácora reconoce las reglas aprendidas ───────────────────────────────────

test('R11: the review log reader keeps the learned rules of each entry, in both languages', () => {
  const [es, en] = allReviews([
    ENTRY('2026-10-07T15:00:00Z', 'revisor', 'Regla aprendida (dinero): Todo valor monetario usa 2 decimales — src/cobro.mjs:17'),
    ENTRY('2026-10-07T16:00:00Z', 'seguridad', '- Learned rule (autenticacion; sinónimos: pin, clave temporal): Tokens expire on sign-out')
  ].join('\n'));

  assert.deepEqual(es.learned, [{ concept: 'dinero', synonyms: [], text: 'Todo valor monetario usa 2 decimales — src/cobro.mjs:17' }]);
  assert.deepEqual(en.learned, [{ concept: 'autenticacion', synonyms: ['pin', 'clave temporal'], text: 'Tokens expire on sign-out' }]);
});

test('R11: an entry without learned rules has an empty list', () => {
  assert.deepEqual(allReviews(ENTRY('2026-10-07T15:00:00Z', 'revisor', ''))[0].learned, []);
});

// ── el estado del portón trae el detalle de las supresiones ───────────────────────────────────

test('R13: the gate state carries each suppression, and the advisor reads it back', () => {
  const allowed = [{ file: 'src/cobro.mjs', line: 16, rule: 'weak-hash', reason: 'la referencia de idempotencia no protege nada' }];
  const state = renderState({ stages: [{ stage: 'security', ok: true, findings: [], allowed }], meta: { date: new Date('2026-10-07T15:00:00Z') }, fast: false });

  assert.deepEqual(state.suppressions, allowed);
  assert.deepEqual(parseGateState(JSON.stringify(state)).suppressions, allowed);
  assert.deepEqual(parseGateState(JSON.stringify({ date: '2026-10-07T15:00:00Z', verdict: 'pass' })).suppressions, []);
});

// ── la captura ────────────────────────────────────────────────────────────────────────────────

async function repo(files) {
  const root = await mkdtemp(join(tmpdir(), 'chalc-capture-'));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

const TASKS = (marker = '') => `- [x] **T1** (R1) — Preparar el cobro.\n- [ ] **T2** (R2)${marker} — Rechazar montos fuera de rango.\n`;
const REVIEW = ENTRY('2026-10-07T15:00:00Z', 'revisor', 'Regla aprendida (dinero): Todo valor monetario usa 2 decimales — src/cobro.mjs:17');
const STATE = JSON.stringify({
  date: '2026-10-07T14:00:00Z', verdict: 'pass', fast: false,
  suppressions: [{ file: 'src/cobro.mjs', line: 16, rule: 'weak-hash', reason: 'la referencia de idempotencia solo deduplica cobros' }]
});

const project = (marker) => repo({
  'specs/001-cobros/spec.md': '- **R2** — IF el monto no es válido THEN THE SYSTEM SHALL rechazarlo.\n',
  'specs/001-cobros/tasks.md': TASKS(marker),
  '.chalc/review.md': REVIEW,
  '.chalc/gate.state.json': STATE
});

test('R11: closing a task stores each learned rule with its concept, files and origin', async () => {
  const root = await project();
  await capture(root, { now: new Date('2026-10-07T16:00:00Z') });

  const rule = (await readMemory(root)).entries.find((e) => e.kind === 'rule');
  assert.deepEqual(
    { concepts: rule.concepts, title: rule.title, files: rule.files, origin: rule.origin },
    { concepts: ['dinero'], title: 'Todo valor monetario usa 2 decimales', files: ['src/cobro.mjs'], origin: { spec: '001-cobros', task: 'T2', role: 'revisor' } }
  );
});

test('R12: the rules of a task marked [bug] are stored as bug lessons', async () => {
  const root = await project(' `[bug]`');
  await capture(root, { now: new Date('2026-10-07T16:00:00Z') });
  assert.equal((await readMemory(root)).entries.find((e) => e.origin.task === 'T2' && e.kind !== 'decision').kind, 'bug');
});

test('R13: each accepted suppression is stored as a decision, with its reason', async () => {
  const root = await project();
  await capture(root, { now: new Date('2026-10-07T16:00:00Z') });

  const decision = (await readMemory(root)).entries.find((e) => e.kind === 'decision');
  assert.equal(decision.title, 'weak-hash aceptado en src/cobro.mjs: la referencia de idempotencia solo deduplica cobros');
  assert.deepEqual(decision.files, ['src/cobro.mjs']);
});

// Lo que se capturó una vez no se vuelve a sumar: la segunda captura solo mira lo nuevo.
test('R11: capturing twice does not count the same rule twice', async () => {
  const root = await project();
  await capture(root, { now: new Date('2026-10-07T16:00:00Z') });
  await capture(root, { now: new Date('2026-10-07T17:00:00Z') });

  const rule = (await readMemory(root)).entries.find((e) => e.kind === 'rule');
  assert.equal(rule.seen, 1);
});

test('R6: the synonyms a role gives with a rule are learned by the repo', async () => {
  const root = await project();
  await writeFile(join(root, '.chalc/review.md'), ENTRY('2026-10-07T15:00:00Z', 'revisor', 'Regla aprendida (dinero; sinónimos: comisión): Las comisiones se redondean a 2 decimales'));
  await capture(root, { now: new Date('2026-10-07T16:00:00Z') });

  assert.deepEqual(conceptsIn('liquidar la comisión', await loadConcepts(root)), ['dinero']);
});

test('R11: with nothing written by the cycle, capture stores nothing and does not fail', async () => {
  const root = await repo({});
  assert.deepEqual(await capture(root, { now: new Date() }), { rules: 0, decisions: 0 });
});
