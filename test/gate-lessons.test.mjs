// Spec 036 (memoria compartida), T4 — el portón que no aprueba deja huella (R4): cada regla incumplida se anota
// como candidata y suma cuando se repite. Anotar nunca cambia el resultado del portón.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { runGate } from '../catalog/gate/gate.mjs';
import { MAX_NOTED, noteFailure } from '../catalog/gate/lib/lessons.mjs';
import { readMemory } from '../catalog/memory/lib/store.mjs';
import { candidatesOf } from '../catalog/memory/lib/lessons.mjs';

const finding = (rule, file) => ({ rule, file, line: 1, data: {} });
const STAGES = [
  { stage: 'lint', ok: false, findings: [finding('function-too-long', 'src/a.ts'), finding('function-too-long', 'src/b.ts'), finding('file-too-long', 'src/a.ts')] },
  { stage: 'tests', ok: true, findings: [] },
  { stage: 'mutation', ok: false, skipped: true, reason: 'fast', findings: [finding('no-cuenta', 'x')] },
  { stage: 'security', ok: true, findings: [finding('avisos-de-una-etapa-que-pasó', 'x')] }
];
const keys = async (root) => (await readMemory(root)).entries.map((e) => [e.key, e.seen, e.files]);

test('R4: cada regla incumplida de una etapa que falló se anota una vez, con sus archivos', async (t) => {
  const root = await tempDir(t, 'chalc-036-gate-');
  assert.equal(await noteFailure(root, STAGES), 2);
  assert.deepEqual(await keys(root), [['gate:function-too-long', 1, ['src/a.ts', 'src/b.ts']], ['gate:file-too-long', 1, ['src/a.ts']]]);
  const entry = (await readMemory(root)).entries[0];
  assert.deepEqual([entry.kind, entry.title, entry.origin], ['candidate', 'gate: function-too-long', { role: 'gate', stage: 'lint' }]);
});

test('R4: lo que se repite entre corridas suma, y pasa a ser candidata', async (t) => {
  const root = await tempDir(t, 'chalc-036-gate-');
  await noteFailure(root, STAGES);
  await noteFailure(root, [STAGES[0]]);
  assert.deepEqual(candidatesOf((await readMemory(root)).entries).map((e) => [e.key, e.seen]).sort(), [['gate:file-too-long', 2], ['gate:function-too-long', 2]]);
});

test('R4: una etapa que falla sin hallazgos se anota por su nombre; una corrida sin fallos no anota nada; y hay un tope por corrida', async (t) => {
  const root = await tempDir(t, 'chalc-036-gate-');
  await noteFailure(root, [{ stage: 'tests', ok: false, findings: [] }, { stage: 'config', ok: false, blocked: true }]);
  assert.deepEqual((await keys(root)).map(([key]) => key), ['gate:stage:tests', 'gate:stage:config']);
  const clean = await tempDir(t, 'chalc-036-gate-');
  assert.equal(await noteFailure(clean, [STAGES[1], STAGES[3]]), 0);
  assert.deepEqual(await keys(clean), []);
  const many = await tempDir(t, 'chalc-036-gate-');
  assert.equal(MAX_NOTED, 5);
  assert.equal(await noteFailure(many, [{ stage: 'lint', ok: false, findings: Array.from({ length: 9 }, (_, n) => finding(`regla-${n}`, 'a')) }]), MAX_NOTED);
});

test('R4: si la memoria no se puede escribir, anotar no lanza nada', async (t) => {
  const root = await tempDir(t, 'chalc-036-gate-');
  await mkdir(join(root, '.chalc'), { recursive: true });
  await writeFile(join(root, '.chalc', 'memory'), 'no es una carpeta');
  assert.equal(await noteFailure(root, STAGES), 0);
});

test('R4: una corrida real del portón que no aprueba deja su candidata, y el código de salida es el mismo', async (t) => {
  const root = await tempDir(t, 'chalc-036-gate-');
  const first = await runGate({ root });
  assert.notEqual(first.verdict, 'pass');
  assert.equal(first.code, 1);
  const noted = (await readMemory(root)).entries;
  assert.ok(noted.length >= 1 && noted.every((e) => e.key.startsWith('gate:') && e.seen === 1), JSON.stringify(noted));
  await runGate({ root });
  assert.ok(candidatesOf((await readMemory(root)).entries).length >= 1);
});
