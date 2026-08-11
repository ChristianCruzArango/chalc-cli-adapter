// T15 (R12, R6) — la entrada del advisor: de un repo en disco a tres líneas.
//
// El formato es un contrato, no una presentación: el asistente lee `NEXT_ACTION` para saber qué
// hacer y `COMMAND` para ejecutarlo. Por eso las tres líneas van siempre, en el mismo orden, aunque
// el comando esté vacío — un formato que cambia de forma según el caso obliga a quien lo consume a
// adivinar, y volveríamos a depender del criterio del modelo.
//
// Y el código de salida separa dos cosas que un guion necesita distinguir: "el flujo avanza"
// (incluido `done`, incluido `blocked_config`) de "el advisor no sabe dónde está" (`ask_human`).

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { advise, render } from '../catalog/next/next.mjs';

const SPEC = 'specs/008-advisor';

// Línea de tiempo fija: código tocado, luego medido, luego revisado.
const TOUCHED = Date.parse('2026-08-09T12:00:00Z');
const MEASURED = Date.parse('2026-08-09T13:00:00Z');
const REVIEWED = Date.parse('2026-08-09T14:00:00Z');

async function repo({ tasks = '- [x] T1\n- [ ] T2 — en esto voy\n', config, state, review } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'chalc-entry-'));
  await mkdir(join(root, '.chalc'), { recursive: true });
  await mkdir(join(root, SPEC), { recursive: true });
  await mkdir(join(root, 'src'), { recursive: true });

  await writeFile(join(root, '.chalc', 'gate.json'), JSON.stringify(config ?? { spec: { dir: 'specs' }, pending: [], language: 'es' }));
  if (tasks !== null) await writeFile(join(root, SPEC, 'tasks.md'), tasks);
  if (state) await writeFile(join(root, '.chalc', 'gate.state.json'), JSON.stringify(state));
  if (review) await writeFile(join(root, '.chalc', 'review.md'), review);
  // El fuente se envejece a un instante fijo para que la evidencia pueda ser posterior a él sin
  // depender de cuándo corra el test. Sin esto, cualquier repo "terminado" tendría trabajo sin medir.
  await writeFile(join(root, 'src', 'pago.ts'), 'export const x = 1;\n');
  await utimes(join(root, 'src', 'pago.ts'), TOUCHED / 1000, TOUCHED / 1000);
  return root;
}

// Un repo con la feature de verdad cerrada: todo marcado, evidencia posterior al código y revisión
// posterior a la evidencia.
const finished = () => repo({
  tasks: '- [x] T1\n- [x] T2\n',
  state: { date: new Date(MEASURED).toISOString(), verdict: 'pass', fast: false, branch: '' },
  review: `## ${new Date(REVIEWED).toISOString().replace(/\.\d+Z$/, 'Z')} · a1b2c3d4e5 · revisor · OK\n`
});

// ── R6: las tres líneas, siempre ──────────────────────────────────────────────────────────────

test('R6 — la salida son exactamente tres campos, en orden fijo', () => {
  const lines = render({ action: 'run_gate', reason: 'porque sí', command: 'node .chalc/gate.mjs' }).split('\n');

  assert.equal(lines.length, 3);
  assert.equal(lines[0], 'NEXT_ACTION: run_gate');
  assert.equal(lines[1], 'REASON: porque sí');
  assert.equal(lines[2], 'COMMAND: node .chalc/gate.mjs');
});

test('R6 — sin comando, la línea sigue estando: el formato no cambia de forma', () => {
  const lines = render({ action: 'work_task', reason: 'toca T2', command: '' }).split('\n');

  assert.equal(lines.length, 3);
  assert.equal(lines[2], 'COMMAND:');
});

test('R6 — un motivo de varias frases no rompe el formato de tres líneas', () => {
  const lines = render({ action: 'done', reason: 'Todo hecho. Nada pendiente.', command: '' }).split('\n');
  assert.equal(lines.length, 3);
});

// ── R12: el código de salida ──────────────────────────────────────────────────────────────────

test('R12 — decidir una acción sale con 0, aunque la acción sea done', async () => {
  const result = await advise({ root: await finished() });

  assert.equal(result.action, 'done');
  assert.equal(result.code, 0);
});

test('R9 — "todo marcado" con código sin medir NO es done: primero se mide', async () => {
  // Un tasks.md lleno de checks no cierra una feature si el último cambio no pasó por el portón.
  const result = await advise({ root: await repo({ tasks: '- [x] T1\n- [x] T2\n' }) });
  assert.equal(result.action, 'run_gate');
});

test('R12 — blocked_config también sale con 0: el flujo sabe qué hacer', async () => {
  const root = await repo({ config: { spec: { dir: 'specs' }, pending: ['test.command'], language: 'es' } });
  const result = await advise({ root });

  assert.equal(result.action, 'blocked_config');
  assert.equal(result.code, 0);
});

test('R12 — solo ask_human sale con código distinto de cero', async () => {
  const root = await repo({ tasks: null });
  const result = await advise({ root });

  assert.equal(result.action, 'ask_human');
  assert.notEqual(result.code, 0);
});

// ── el advisor junta los tres módulos ─────────────────────────────────────────────────────────

test('R6 — la acción trae su motivo redactado y su comando resuelto', async () => {
  const root = await repo();
  const result = await advise({ root });

  assert.ok(result.reason.length, 'el motivo no puede ir vacío');
  assert.equal(typeof result.command, 'string');
});

test('R5 — el motivo sale en el idioma del spec, no en el del CLI', async () => {
  const es = await advise({ root: await repo({ config: { spec: { dir: 'specs' }, pending: [], language: 'es' } }) });
  const en = await advise({ root: await repo({ config: { spec: { dir: 'specs' }, pending: [], language: 'en' } }) });

  assert.equal(es.action, en.action, 'la acción es la misma: solo cambia la redacción');
  assert.notEqual(es.reason, en.reason);
});

test('R6 — run_gate resuelve el comando del portón del repo', async () => {
  const root = await repo({ state: { date: '2020-01-01T00:00:00Z', verdict: 'pass', fast: false, branch: '' } });
  const result = await advise({ root });

  assert.equal(result.action, 'run_gate');
  assert.equal(result.command, 'node .chalc/gate.mjs');
});

test('R8 — pedir consejo no modifica el repo', async () => {
  const root = await repo();
  const before = JSON.stringify(await advise({ root }));

  assert.equal(JSON.stringify(await advise({ root })), before, 'consultar dos veces da lo mismo');
});
