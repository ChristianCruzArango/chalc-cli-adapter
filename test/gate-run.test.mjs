// T24 (R9, R10, R11) — orquestación del portón.
//
// Es la pieza que decide: qué etapas corren, en qué orden, y con qué código sale el proceso. Las
// tres reglas que se prueban aquí son las que hacen que una corrida signifique algo:
//   · sale 0 SOLO si todo lo que se ejecutó pasó (R9)
//   · con los tests en rojo la mutación no corre —no tiene sentido— pero los linters SÍ (R10)
//   · con `--fast` la mutación se omite y la corrida NO cierra una tarea (R11)

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { runGate } from '../catalog/gate/gate.mjs';

async function project(files = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-gate-run-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, typeof content === 'string' ? content : JSON.stringify(content, null, 2), 'utf8');
  }
  return dir;
}

const CONFIG = {
  stack: 'js',
  test: { command: 'npm test' },
  mutation: {
    tool: 'stryker', command: 'npx stryker run', report: 'reports/mutation/mutation.json',
    format: 'elements', install: 'npm i -D @stryker-mutator/core', threshold: 80, required: true, scopeFlag: ''
  },
  lint: { maxFileLines: 300, maxFunctionLines: 40, maxParams: 4, maxDepth: 3 },
  spec: { dir: 'specs' },
  role: 'back',
  language: 'es'
};

// Un repo equipado: config del portón, una spec y un fuente limpio.
const equipped = (over = {}) => project({
  '.chalc/gate.json': { ...CONFIG, ...over },
  'specs/007-carrito/spec.md': '- **R1** — WHEN algo THE SYSTEM SHALL otra cosa.',
  'src/precio.ts': 'export const precio = () => 1;\n'
});

// Ejecutor de mentira: responde por comando y anota lo que se le pidió.
function runner(byCommand = {}) {
  const calls = [];
  const run = async (command) => {
    calls.push(command);
    const answer = Object.entries(byCommand).find(([key]) => command.startsWith(key));
    const { code = 0, writes } = answer ? answer[1] : {};
    if (writes) await writes();
    return { code, ms: 100 };
  };
  run.calls = calls;
  return run;
}

const report = (statuses) => JSON.stringify({
  schemaVersion: '1.0',
  files: {
    'src/precio.ts': {
      mutants: statuses.map((status, i) => ({ id: String(i), mutatorName: 'Arithmetic', location: { start: { line: i + 1 } }, status }))
    }
  }
});

const writeReport = (dir, statuses) => async () => {
  await mkdir(join(dir, 'reports', 'mutation'), { recursive: true });
  await writeFile(join(dir, 'reports', 'mutation', 'mutation.json'), report(statuses), 'utf8');
};

const gate = (root, opts = {}) => runGate({ root, changed: ['src/precio.ts'], ...opts });

const stageOf = (result, name) => result.stages.find((s) => s.stage === name);

// ── R9: el código de salida ───────────────────────────────────────────────────────────────────

test('runGate exits 0 when every stage that ran passed', async () => {
  const dir = await equipped();
  const run = runner({ 'npx stryker': { writes: writeReport(dir, ['Killed', 'Killed', 'Killed', 'Killed']) } });

  const result = await gate(dir, { run });

  assert.equal(result.code, 0);
  assert.equal(result.verdict, 'pass');
});

test('runGate exits non-zero when a stage failed', async () => {
  const dir = await equipped();
  const run = runner({ 'npx stryker': { writes: writeReport(dir, ['Killed', 'Survived']) } });

  const result = await gate(dir, { run });

  assert.notEqual(result.code, 0);
  assert.equal(result.verdict, 'fail');
  assert.equal(stageOf(result, 'mutation').score, 50);
});

test('runGate exits non-zero when a stage could not be verified', async () => {
  const dir = await equipped();
  const run = runner({ 'npx stryker': { code: 0 } });   // corre pero no deja reporte

  const result = await gate(dir, { run });

  assert.notEqual(result.code, 0);
  assert.equal(result.verdict, 'blocked');
  assert.equal(stageOf(result, 'mutation').reason, 'no-report');
});

test('runGate writes the evidence of every run', async () => {
  const dir = await equipped();
  const run = runner({ 'npx stryker': { writes: writeReport(dir, ['Killed']) } });

  await gate(dir, { run });

  const md = await readFile(join(dir, '.chalc', 'gate.md'), 'utf8');
  assert.match(md, /Portón de calidad/, 'la evidencia sale en el idioma de la config');
  assert.match(md, /npm test/);
});

// ── R10: tests en rojo ────────────────────────────────────────────────────────────────────────

// Una corrida rota no puede costar la corrida entera: la mutación no tiene sentido sobre rojo, pero
// los linters sí, y el informe tiene que llegar completo a la primera.
test('runGate skips mutation when the tests fail but still runs the static stages', async () => {
  const dir = await equipped();
  const run = runner({ 'npm test': { code: 1 } });

  const result = await gate(dir, { run });

  assert.equal(stageOf(result, 'tests').ok, false);
  assert.equal(stageOf(result, 'mutation').skipped, true);
  assert.equal(stageOf(result, 'mutation').reason, 'tests-failed');
  assert.ok(!run.calls.some((c) => c.startsWith('npx stryker')), 'no se muta sobre tests en rojo');
  assert.ok(stageOf(result, 'smells'), 'los linters corren igual');
  assert.ok(stageOf(result, 'traceability'));
  assert.equal(result.verdict, 'fail');
});

// ── R11: --fast ──────────────────────────────────────────────────────────────────────────────

test('runGate skips mutation with --fast and says the run does not close a task', async () => {
  const dir = await equipped();
  const run = runner();

  const result = await gate(dir, { run, fast: true });

  assert.equal(stageOf(result, 'mutation').skipped, true);
  assert.equal(stageOf(result, 'mutation').reason, 'fast');
  assert.ok(!run.calls.some((c) => c.startsWith('npx stryker')));
  assert.equal(result.closesTask, false, 'una corrida rápida no es cierre de tarea');

  const md = await readFile(join(dir, '.chalc', 'gate.md'), 'utf8');
  assert.match(md, /no cierra la tarea/i);
});

test('runGate closes a task only when mutation actually ran', async () => {
  const dir = await equipped();
  const run = runner({ 'npx stryker': { writes: writeReport(dir, ['Killed']) } });

  const result = await gate(dir, { run });

  assert.equal(result.closesTask, true);
});

// ── etapas estáticas ──────────────────────────────────────────────────────────────────────────

test('runGate reports the static findings of the changed files', async () => {
  const dir = await project({
    '.chalc/gate.json': CONFIG,
    'specs/007-carrito/spec.md': '- **R1** — WHEN algo THE SYSTEM SHALL otra cosa.',
    'src/precio.ts': 'export interface Precio {}\nexport interface Total {}\n'
  });
  const run = runner({ 'npx stryker': { writes: writeReport(dir, ['Killed']) } });

  const result = await gate(dir, { run });

  const smells = stageOf(result, 'smells');
  assert.equal(smells.ok, false);
  assert.equal(smells.findings[0].rule, 'one-thing-per-file');
  assert.equal(result.verdict, 'fail');
});

test('runGate blocks when the config is missing instead of pretending everything passed', async () => {
  const dir = await project({ 'src/precio.ts': 'export const x = 1;\n' });

  const result = await gate(dir, { run: runner() });

  assert.notEqual(result.code, 0);
  assert.equal(result.verdict, 'blocked');
});

// El comando de tests es lo único que el portón no puede suplir: sin él no hay nada que verificar.
test('runGate blocks when the repo has no test command configured', async () => {
  const dir = await equipped({ test: { command: '' } });

  const result = await gate(dir, { run: runner() });

  assert.equal(stageOf(result, 'tests').blocked, true);
  assert.equal(result.verdict, 'blocked');
});
