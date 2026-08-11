// T8 (spec 013, R4b/R13) — qué hace el portón cuando el alcance no da para revisar.
//
// Son dos situaciones que se parecen —en las dos acabas sin archivos que mirar— y que exigen
// respuestas opuestas:
//
//   · NO SÉ qué cambió la tarea (sin git y sin registro): bloqueo. La salida histórica era revisar
//     el proyecto entero, y eso no es revisar de más: es cambiar de pregunta sin avisar.
//   · SÉ que no cambió nada: se informa y no se aprueba. "No hay nada" y "está bien" no son lo
//     mismo, y confundirlos cierra tareas sin código.
//
// En los dos casos el portón para ahí. Correr tests y mutación para revisar cero archivos son
// minutos tirados en una corrida que no puede aprobar de todas formas.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { runGate } from '../catalog/gate/gate.mjs';
import { RULES } from '../catalog/gate/lib/rules.mjs';
import { sealBaseline } from '../catalog/gate/lib/baseline.mjs';

const CONFIG = {
  stack: 'js',
  test: { command: 'npm test' },
  mutation: { tool: 'stryker', command: 'npx stryker run', report: 'r.json', format: 'elements', threshold: 80, required: true, scopeFlag: '' },
  lint: { maxFileLines: 300, maxFunctionLines: 40, maxParams: 4, maxDepth: 3 },
  spec: { dir: 'specs' },
  role: 'back',
  language: 'es'
};

async function project(files = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-gate-scope-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, typeof content === 'string' ? content : JSON.stringify(content, null, 2), 'utf8');
  }
  return dir;
}

const equipped = (extra = {}) => project({
  '.chalc/gate.json': CONFIG,
  'specs/013-alcance/spec.md': '- **R1** — WHEN algo THE SYSTEM SHALL otra cosa.',
  ...extra
});

// Anota cada comando que se le pide: es como se comprueba que las etapas caras NO se ejecutaron.
function runner() {
  const calls = [];
  const run = async (command) => { calls.push(command); return { code: 0, ms: 1 }; };
  run.calls = calls;
  return run;
}

const git = (dir, args) => new Promise((resolve) => {
  let out = '';
  const child = spawn('git', args, { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] });
  child.stdout.on('data', (chunk) => { out += chunk; });
  child.on('error', () => resolve(''));
  child.on('close', () => resolve(out.trim()));
});

async function committed(dir) {
  await git(dir, ['init', '-q', '-b', 'main', '.']);
  await git(dir, ['config', 'user.email', 'test@chalc.dev']);
  await git(dir, ['config', 'user.name', 'chalc test']);
  await git(dir, ['config', 'commit.gpgsign', 'false']);
  await git(dir, ['add', '-A']);
  await git(dir, ['commit', '-q', '-m', 'todo dentro']);
  return git(dir, ['rev-parse', 'HEAD']);
}

const findingsOf = (result) => result.stages.flatMap((s) => s.findings || []).map((f) => f.rule);

// ── no sé qué revisar ─────────────────────────────────────────────────────────────────────────

test('an undetermined scope blocks the run instead of reviewing the whole project', async () => {
  const dir = await equipped({ 'src/precio.ts': 'export const p = 1;\n', 'src/otro.ts': 'export const o = 2;\n' });

  const result = await runGate({ root: dir, run: runner() });

  assert.equal(result.verdict, 'blocked');
  assert.notEqual(result.code, 0);
  assert.equal(result.closesTask, false);
  assert.ok(findingsOf(result).includes(RULES.scopeUndetermined));
});

// Bloquear y luego gastar cinco minutos midiendo mutación sería absurdo, pero lo que importa aquí es
// otra cosa: si las etapas corrieran, correrían sobre el árbol ENTERO, que es justo lo prohibido.
test('nothing expensive runs when the scope could not be determined', async () => {
  const dir = await equipped({ 'src/precio.ts': 'export const p = 1;\n' });
  const run = runner();

  await runGate({ root: dir, run });

  assert.deepEqual(run.calls, [], 'ni tests ni mutación');
});

// ── sé que no hay nada ────────────────────────────────────────────────────────────────────────

test('an empty scope is reported and never approved', async () => {
  const dir = await equipped({ 'src/precio.ts': 'export const p = 1;\n' });
  const head = await committed(dir);
  await sealBaseline(dir, { commit: head });

  const result = await runGate({ root: dir, run: runner() });

  assert.notEqual(result.verdict, 'pass', '"no hay nada" no es "está bien"');
  assert.equal(result.closesTask, false);
  assert.ok(findingsOf(result).includes(RULES.scopeEmpty));
});

// La diferencia que decide el arreglo: un bloqueo dice "no pude comprobarlo" y un fallo dice "lo
// comprobé". Un alcance vacío es lo segundo — se sabe, y se sabe desde cuándo.
test('an empty scope is a fact, not a blocked run', async () => {
  const dir = await equipped({ 'src/precio.ts': 'export const p = 1;\n' });
  const head = await committed(dir);
  await sealBaseline(dir, { commit: head });

  const result = await runGate({ root: dir, run: runner() });

  assert.notEqual(result.verdict, 'blocked');
});

// La referencia va en la evidencia: sin ella, "nada cambió" es incomprobable.
test('the evidence says which reference the empty scope was measured against', async () => {
  const dir = await equipped({ 'src/precio.ts': 'export const p = 1;\n' });
  const head = await committed(dir);
  await sealBaseline(dir, { commit: head });

  const result = await runGate({ root: dir, run: runner() });
  const finding = result.stages.flatMap((s) => s.findings || []).find((f) => f.rule === RULES.scopeEmpty);

  assert.equal(finding.data.from, head);
});

// ── con alcance, el portón es el de siempre ───────────────────────────────────────────────────

test('a determined scope runs the stages as usual', async () => {
  const dir = await equipped({ 'src/precio.ts': 'export const p = 1;\n' });
  const head = await committed(dir);
  await sealBaseline(dir, { commit: head });
  await writeFile(join(dir, 'src', 'nuevo.ts'), 'export const n = 1;\n', 'utf8');
  const run = runner();

  const result = await runGate({ root: dir, run });

  assert.ok(run.calls.includes('npm test'), 'los tests sí corren');
  assert.equal(findingsOf(result).includes(RULES.scopeUndetermined), false);
  assert.equal(findingsOf(result).includes(RULES.scopeEmpty), false);
});

// Los tests del portón inyectan la lista de cambiados para no depender de git. Esa puerta se queda:
// una lista dada explícitamente ES un alcance determinado, y no tiene que pasar por las fuentes.
test('an injected list of changed files is a scope in its own right', async () => {
  const dir = await equipped({ 'src/precio.ts': 'export const p = 1;\n' });
  const run = runner();

  const result = await runGate({ root: dir, run, changed: ['src/precio.ts'] });

  assert.ok(run.calls.includes('npm test'), 'la corrida sigue su curso');
  assert.deepEqual(findingsOf(result).filter((r) => r.startsWith('scope-')), [], 'el alcance no se queja de nada');
});
