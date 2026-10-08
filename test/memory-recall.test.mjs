// spec 015 · T8 (R10, R15, R18) — qué le toca a cada tarea: carga perezosa.
//
// La memoria entera nunca se entrega. Primero se decide de qué conceptos habla la TAREA —su texto y
// los requisitos que cita—, y solo si no dice nada se mira la spec. Una spec de toda una app toca
// casi todos los conceptos: usarla entera le daría a cada tarea reglas que no son suyas.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConcepts } from '../catalog/memory/lib/concepts.mjs';
import { recall, taskConcepts } from '../catalog/memory/lib/recall.mjs';

const concepts = await loadConcepts(await mkdtemp(join(tmpdir(), 'chalc-recall-')));

const SPEC = [
  '# Spec: tienda',
  'Conceptos: dinero, fechas',
  '- **R1** — WHEN se muestra el catálogo THE SYSTEM SHALL listar los productos.',
  '- **R2** — WHEN se calcula la tarifa de envío THE SYSTEM SHALL sumarla al total.',
  '- **R3** — WHEN el usuario inicia sesión THE SYSTEM SHALL recordar su carrito.'
].join('\n');

test('R10: the task text and the requirements it cites decide its concepts', () => {
  assert.deepEqual(taskConcepts({ task: '**T2** (R2) — Calcular el envío', spec: SPEC, concepts }), ['dinero']);
  assert.deepEqual(taskConcepts({ task: '**T3** (R3) — Recordar el carrito', spec: SPEC, concepts }), ['autenticacion', 'identidad']);
});

test('R10: a task that says nothing falls back to the spec Conceptos line', () => {
  assert.deepEqual(taskConcepts({ task: '**T1** (R1) — Listar el catálogo', spec: SPEC, concepts }), ['dinero', 'fechas']);
});

test('R10: with no line in the spec, the whole spec text is the last resort', () => {
  const noLine = SPEC.replace('Conceptos: dinero, fechas\n', '');
  assert.deepEqual(taskConcepts({ task: '**T1** (R1) — Listar el catálogo', spec: noLine, concepts }), ['autenticacion', 'dinero', 'identidad']);
});

test('R10: the Conceptos line accepts synonyms and other languages', () => {
  const spec = 'Concepts: Money, users\n- **R1** — WHEN algo THE SYSTEM SHALL otra cosa.';
  assert.deepEqual(taskConcepts({ task: '**T1** (R1) — Hacer algo', spec, concepts }), ['dinero', 'identidad']);
});

// ── las reglas que se entregan ────────────────────────────────────────────────────────────────

const entry = (over) => ({ id: over.key.slice(0, 8).padEnd(8, '0'), kind: 'rule', concepts: ['dinero'], title: over.key, seen: 1, date: '2026-10-01T00:00:00Z', files: [], ...over });

const MEMORY = [
  entry({ key: 'decision-md5', kind: 'decision', seen: 9 }),
  entry({ key: 'regla-2-decimales', seen: 3 }),
  entry({ key: 'bug-montos', kind: 'bug', seen: 1 }),
  entry({ key: 'regla-utc', concepts: ['fechas'], seen: 5 }),
  entry({ key: 'regla-vieja', seen: 3, date: '2026-01-01T00:00:00Z' })
];

test('R15: only entries of the task concepts are delivered, bugs first, then rules, then decisions', () => {
  assert.deepEqual(recall(MEMORY, ['dinero']).map((e) => e.key), ['bug-montos', 'regla-2-decimales', 'regla-vieja', 'decision-md5']);
});

test('R15: never more than the limit, whatever the memory holds', () => {
  const many = Array.from({ length: 1000 }, (_, i) => entry({ key: `regla-${i}`, seen: i }));
  const got = recall(many, ['dinero']);
  assert.equal(got.length, 5);
  assert.deepEqual(got.map((e) => e.seen), [999, 998, 997, 996, 995]);
});

test('R18: no concepts or no matching entries means nothing is delivered', () => {
  assert.deepEqual(recall(MEMORY, []), []);
  assert.deepEqual(recall(MEMORY, ['archivos']), []);
  assert.deepEqual(recall([], ['dinero']), []);
});

// ── bordes ────────────────────────────────────────────────────────────────────────────────────

test('R10: the concepts line is read with any spacing, and only at the start of a line', () => {
  const task = '**T1** (R1) — Listar el catálogo';
  const req = '- **R1** — WHEN se lista THE SYSTEM SHALL mostrar.';
  assert.deepEqual(taskConcepts({ task, spec: `Concepts:dinero\n${req}`, concepts }), ['dinero']);
  assert.deepEqual(taskConcepts({ task, spec: `  Conceptos :  fechas\n${req}`, concepts }), ['fechas']);
  assert.deepEqual(taskConcepts({ task, spec: `Ver los conceptos: dinero\n${req}`, concepts }), ['dinero'], 'cae al texto completo');
});

test('R10: a task citing R12 reads R12, not R1, and a task citing two reads both', () => {
  const spec = '- **R1** — WHEN se paga THE SYSTEM SHALL cobrar.\n- **R12** — WHEN pasa una fecha THE SYSTEM SHALL avisar.';
  assert.deepEqual(taskConcepts({ task: '**T9** (R12) — Avisar', spec, concepts }), ['fechas']);
  assert.deepEqual(taskConcepts({ task: '**T9** (R1, R12) — Ambas', spec, concepts }), ['dinero', 'fechas']);
});

test('R10: concept ids are accepted directly, and empty items are ignored', () => {
  const spec = 'Conceptos: datos-personales, , dinero\n- **R1** — WHEN algo THE SYSTEM SHALL otra cosa.';
  assert.deepEqual(taskConcepts({ task: '**T1** (R1) — Algo', spec, concepts }), ['datos-personales', 'dinero']);
});

test('R15: an entry with several concepts is delivered when one of them applies', () => {
  const both = entry({ key: 'mixta', concepts: ['dinero', 'fechas'] });
  assert.deepEqual(recall([both], ['fechas']).map((e) => e.key), ['mixta']);
});

// Un id con guion (`datos-personales`) solo se reconoce leyendo la línea: en el texto suelto son dos
// palabras que no son sinónimo de nada. Eso permite comprobar exactamente cuándo se lee la línea.
const LINE_SPEC = (line) => `${line}\n- **R1** — WHEN se lista THE SYSTEM SHALL mostrar.`;
const fromLine = (line) => taskConcepts({ task: '**T1** (R1) — Listar', spec: LINE_SPEC(line), concepts });

test('R10: the concepts line is a declaration only at the start of a line and with the exact word', () => {
  assert.deepEqual(fromLine('Conceptos:datos-personales'), ['datos-personales']);
  assert.deepEqual(fromLine('  Concepts :   datos-personales  '), ['datos-personales']);
  assert.deepEqual(fromLine('Ver los Conceptos: datos-personales'), []);
  assert.deepEqual(fromLine('- Conceptos: datos-personales'), []);
  assert.deepEqual(fromLine('Conceptosx: datos-personales'), []);
});

test('R10: declared concepts come back sorted and deduplicated', () => {
  assert.deepEqual(fromLine('Conceptos: fechas, datos-personales, fechas'), ['datos-personales', 'fechas']);
});

test('R10: a task citing two requirements reads both, before looking at the spec line', () => {
  const spec = 'Conceptos: datos-personales\n- **R1** — WHEN se paga THE SYSTEM SHALL cobrar.\n- **R12** — WHEN pasa una fecha THE SYSTEM SHALL avisar.\n- **R3** — WHEN algo THE SYSTEM SHALL nada.';
  assert.deepEqual(taskConcepts({ task: '**T9** (R1, R12) — Ambas', spec, concepts }), ['dinero', 'fechas']);
  assert.deepEqual(taskConcepts({ task: '**T9** — Sin requisitos', spec, concepts }), ['datos-personales']);
});
