// T5 (spec 018, R1, R2) — el portón compila.
//
// Encontrado en el E2E de la spec 017: código que `tsc` rechazaba (imports sin `.js` bajo `nodenext`)
// pasó el portón y a los tres roles, porque el portón solo corría tests —Vitest los tolera— y mutación.
// La etapa `build` corre el comando de compilación del repo después de los tests y antes de la mutación,
// también con `--fast` (compilar es barato frente a mutar). Sin nada que compilar no aplica; sin la
// herramienta instalada bloquea con el comando para instalarla, sin descargar nada.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { runBuild } from '../catalog/gate/lib/build.mjs';
import { runGate } from '../catalog/gate/gate.mjs';
import { RULES } from '../catalog/gate/lib/rules.mjs';
import { messageOf, frameOf } from '../catalog/gate/lib/i18n.mjs';
import { renderEvidence } from '../catalog/gate/lib/evidence.mjs';

async function project(files = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-gate-build-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, typeof content === 'string' ? content : JSON.stringify(content, null, 2), 'utf8');
  }
  return dir;
}

function runner(byCommand = {}) {
  const calls = [];
  const run = async (command) => {
    calls.push(command);
    const answer = Object.entries(byCommand).find(([key]) => command.startsWith(key));
    return { code: answer ? answer[1] : 0, ms: 100 };
  };
  run.calls = calls;
  return run;
}

const BUILD = { command: 'npx --no-install tsc --noEmit -p tsconfig.json', probe: 'node_modules/.bin/tsc', install: 'npm i -D typescript' };

// ── la etapa sola ─────────────────────────────────────────────────────────────────────────────

test('R1: a build that compiles passes', async () => {
  const root = await project({ 'node_modules/.bin/tsc': '' });
  const stage = await runBuild({ build: BUILD }, { root, run: runner() });
  assert.deepEqual({ stage: stage.stage, ok: stage.ok, blocked: stage.blocked, command: stage.command, code: stage.code }, {
    stage: 'build', ok: true, blocked: false, command: BUILD.command, code: 0
  });
  assert.deepEqual(stage.findings, []);
  assert.equal(stage.reason, '');
});

test('R1: a build that does not compile fails with build-failed and names the command', async () => {
  const root = await project({ 'node_modules/.bin/tsc': '' });
  const stage = await runBuild({ build: BUILD }, { root, run: runner({ npx: 2 }) });
  assert.equal(stage.ok, false);
  assert.equal(stage.blocked, false);
  assert.deepEqual(stage.findings, [{ file: '', line: 0, rule: RULES.buildFailed, data: { command: BUILD.command, code: 2 } }]);
});

test('R2: with nothing to compile the stage does not apply, and does not block', async () => {
  const root = await project();
  for (const config of [{}, { build: {} }, { build: { command: '' } }, undefined]) {
    const stage = await runBuild(config, { root, run: runner() });
    assert.deepEqual({ ok: stage.ok, blocked: stage.blocked, skipped: stage.skipped, reason: stage.reason }, { ok: true, blocked: false, skipped: true, reason: 'not-applicable' });
  }
});

test('R2: without the tool installed it blocks with the install command, and runs nothing', async () => {
  const root = await project();
  const run = runner();
  const stage = await runBuild({ build: BUILD }, { root, run });
  assert.equal(stage.blocked, true);
  assert.deepEqual(stage.findings, [{ file: '', line: 0, rule: RULES.buildNotInstalled, data: { tool: BUILD.command, install: BUILD.install } }]);
  assert.deepEqual(run.calls, []);
  assert.deepEqual({ command: stage.command, code: stage.code, reason: stage.reason }, { command: '', code: null, reason: RULES.buildNotInstalled });
});

test('R2: a command that is not found (127 / 9009) blocks as not installed', async () => {
  const root = await project();
  for (const code of [127, 9009]) {
    const stage = await runBuild({ build: { command: 'dotnet build --nologo' } }, { root, run: runner({ dotnet: code }) });
    assert.equal(stage.blocked, true, String(code));
    assert.equal(stage.findings[0].rule, RULES.buildNotInstalled);
    assert.deepEqual(stage.findings[0].data, { tool: 'dotnet build --nologo', install: '' });
  }
});

test('R1: every build reason has a text in both languages, and the stage a name', () => {
  for (const lang of ['es', 'en']) {
    assert.match(messageOf(RULES.buildFailed, { command: 'npm run build', code: 2 }, lang), /npm run build/);
    assert.match(messageOf(RULES.buildNotInstalled, { tool: 'tsc', install: 'npm i -D typescript' }, lang), /npm i -D typescript/);
    assert.ok(frameOf(lang).stages.build);
    assert.ok(frameOf(lang).status.skippedBuild);
  }
});

// ── dentro del portón ─────────────────────────────────────────────────────────────────────────

const CONFIG = {
  stack: 'js',
  test: { command: 'npm test' },
  build: { command: 'npm run build' },
  mutation: { tool: 'stryker', command: 'npx stryker run', report: 'reports/mutation/mutation.json', format: 'elements', install: '', threshold: 80, required: true, scopeFlag: '' },
  lint: { maxFileLines: 300, maxFunctionLines: 40, maxParams: 4, maxDepth: 3 },
  spec: { dir: 'specs' },
  language: 'es'
};
const equipped = (over = {}) => project({
  '.chalc/gate.json': { ...CONFIG, ...over },
  'specs/001-x/spec.md': '- **R1** — WHEN algo THE SYSTEM SHALL otra cosa.',
  'src/precio.ts': 'export const precio = () => 1;\n'
});
const gate = (root, opts = {}) => runGate({ root, changed: ['src/precio.ts'], ...opts });
const stageOf = (result, name) => result.stages.find((s) => s.stage === name);

test('R1: code that does not compile does not pass the gate, and mutation is not run', async () => {
  const root = await equipped();
  const run = runner({ 'npm run build': 1 });
  const result = await gate(root, { run });
  assert.equal(result.verdict, 'fail');
  assert.equal(stageOf(result, 'build').ok, false);
  assert.deepEqual({ skipped: stageOf(result, 'mutation').skipped, reason: stageOf(result, 'mutation').reason }, { skipped: true, reason: 'build-failed' });
  assert.ok(!run.calls.some((c) => c.startsWith('npx stryker')));
});

test('R1: the build runs after the tests and before the mutation', async () => {
  const root = await equipped();
  const run = runner();
  const result = await gate(root, { run });
  assert.deepEqual(result.stages.slice(0, 3).map((s) => s.stage), ['tests', 'build', 'mutation']);
  assert.deepEqual(run.calls.slice(0, 2), ['npm test', 'npm run build']);
});

test('R1: --fast still compiles', async () => {
  const root = await equipped();
  const run = runner({ 'npm run build': 1 });
  const result = await gate(root, { run, fast: true });
  assert.equal(stageOf(result, 'build').ok, false);
  assert.equal(result.verdict, 'fail');
});

test('R1: with the tests red the build still runs, and mutation is skipped for the tests', async () => {
  const root = await equipped();
  const run = runner({ 'npm test': 1 });
  const result = await gate(root, { run });
  assert.ok(run.calls.includes('npm run build'));
  assert.equal(stageOf(result, 'mutation').reason, 'tests-failed');
});

test('R2: a repo with nothing to compile passes the stage as not applicable', async () => {
  const root = await equipped({ build: { command: '' } });
  // `--fast` aísla la etapa: el runner de mentira no escribe reporte, y la mutación bloquearía por eso.
  const result = await gate(root, { run: runner(), fast: true });
  assert.equal(stageOf(result, 'build').skipped, true);
  assert.equal(result.verdict, 'pass');
});

test('R1: the evidence says why the mutation was not run', async () => {
  const root = await equipped();
  const result = await gate(root, { run: runner({ 'npm run build': 1 }) });
  const md = renderEvidence({ stages: result.stages, meta: { date: new Date(), branch: 'b', role: '', spec: '' }, lang: 'es' });
  assert.match(md, /no ejecutada: no compila/);
});
