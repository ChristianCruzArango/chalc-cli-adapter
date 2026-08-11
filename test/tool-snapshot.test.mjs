// T1 (R11) — la instantánea de lo que la detección produce HOY.
//
// La spec 011 mueve el conocimiento de stacks de código a datos. Eso es una refactorización: al
// terminar, chalc tiene que saber exactamente lo mismo que sabía. Sin una red que lo fije, un cambio
// silencioso en la detección se descubriría meses después, en el repo de alguien, con el portón
// pidiendo una herramienta que no era.
//
// Por eso este archivo se escribe ANTES de mover nada, contra el código actual y en verde, y NO se
// toca durante la refactorización. Si algo aquí se pone rojo, la respuesta correcta es arreglar el
// código nuevo — nunca ajustar la expectativa.
//
// Cubre un repo por stack más los casos que hoy deciden una rama: framework de JS presente, ausente
// y ambiguo, el `test` placeholder de `npm init`, Dart con y sin Flutter, y Python con y sin pytest.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { detectGateConfig } from '../lib/gatedetect.mjs';

async function project(files) {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-tools-snap-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, typeof content === 'string' ? content : JSON.stringify(content, null, 2), 'utf8');
  }
  return dir;
}

// Solo lo que la tabla aporta. El resto de la config (lint, spec, flow, role, language) tiene sus
// propios tests y no es conocimiento de stack.
const detected = async (files) => {
  const cfg = await detectGateConfig(await project(files), { role: 'back', language: 'es' });
  return { stack: cfg.stack, test: cfg.test.command, mutation: cfg.mutation, pending: cfg.pending };
};

const MUTATION_NONE = {
  tool: '', command: '', report: '', format: '', install: '', probe: '', scopeFlag: '',
  threshold: 80, required: true
};

// ── JS / TS ───────────────────────────────────────────────────────────────────────────────────

test('R11 — js + jest', async () => {
  assert.deepEqual(await detected({
    'package.json': { name: 'a', devDependencies: { jest: '^29.0.0' }, scripts: { test: 'jest' } }
  }), {
    stack: 'js',
    test: 'npm test',
    mutation: {
      tool: 'stryker',
      command: 'npx --no-install stryker run',
      report: 'reports/mutation/mutation.json',
      format: 'elements',
      install: 'npm i -D @stryker-mutator/core @stryker-mutator/jest-runner',
      probe: 'node_modules/.bin/stryker',
      scopeFlag: '--mutate',
      threshold: 80,
      required: true
    },
    pending: []
  });
});

test('R11 — js + karma detectado por su archivo de configuración', async () => {
  const cfg = await detected({
    'package.json': { name: 'a', scripts: { test: 'ng test' } },
    'karma.conf.js': 'module.exports = function () {};\n'
  });

  assert.equal(cfg.mutation.install, 'npm i -D @stryker-mutator/core @stryker-mutator/karma-runner');
  assert.equal(cfg.test, 'npm test');
});

test('R11 — js + vitest', async () => {
  const cfg = await detected({
    'package.json': { name: 'a', devDependencies: { vitest: '^1.0.0' }, scripts: { test: 'vitest run' } }
  });

  assert.equal(cfg.mutation.install, 'npm i -D @stryker-mutator/core @stryker-mutator/vitest-runner');
});

test('R11 — js + mocha', async () => {
  const cfg = await detected({
    'package.json': { name: 'a', devDependencies: { mocha: '^10.0.0' }, scripts: { test: 'mocha' } }
  });

  assert.equal(cfg.mutation.install, 'npm i -D @stryker-mutator/core @stryker-mutator/mocha-runner');
});

test('R11 — js + jasmine', async () => {
  const cfg = await detected({
    'package.json': { name: 'a', devDependencies: { jasmine: '^5.0.0' }, scripts: { test: 'jasmine' } }
  });

  assert.equal(cfg.mutation.install, 'npm i -D @stryker-mutator/core @stryker-mutator/jasmine-runner');
});

test('R11 — js sin framework: sin runner no hay mutación', async () => {
  const cfg = await detected({ 'package.json': { name: 'a', scripts: { test: 'node --test' } } });

  assert.deepEqual(cfg.mutation, MUTATION_NONE);
  assert.deepEqual(cfg.pending, ['mutation.command']);
});

test('R11 — js con DOS frameworks es ambiguo, y ambiguo es "no sé"', async () => {
  const cfg = await detected({
    'package.json': { name: 'a', devDependencies: { jest: '^29.0.0', vitest: '^1.0.0' }, scripts: { test: 'jest' } }
  });

  assert.deepEqual(cfg.mutation, MUTATION_NONE);
});

test('R11 — js con el `test` que deja npm init NO cuenta como comando', async () => {
  const cfg = await detected({
    'package.json': { name: 'a', scripts: { test: 'echo "Error: no test specified" && exit 1' } }
  });

  assert.equal(cfg.test, '');
  assert.ok(cfg.pending.includes('test.command'));
});

test('R11 — js sin scripts', async () => {
  assert.equal((await detected({ 'package.json': { name: 'a' } })).test, '');
});

// ── .NET ──────────────────────────────────────────────────────────────────────────────────────

test('R11 — dotnet', async () => {
  assert.deepEqual(await detected({ 'App.csproj': '<Project></Project>\n' }), {
    stack: 'dotnet',
    test: 'dotnet test',
    mutation: {
      tool: 'stryker-net',
      command: 'dotnet stryker',
      report: 'StrykerOutput/**/reports/mutation-report.json',
      format: 'elements',
      install: 'dotnet new tool-manifest && dotnet tool install dotnet-stryker',
      probe: '.config/dotnet-tools.json',
      scopeFlag: '--mutate',
      scopeJoin: 'repeat',
      threshold: 80,
      required: true
    },
    pending: []
  });
});

// ── Dart / Flutter ────────────────────────────────────────────────────────────────────────────

test('R11 — dart puro', async () => {
  const cfg = await detected({ 'pubspec.yaml': 'name: demo\ndependencies:\n  args: ^2.0.0\n' });

  assert.equal(cfg.stack, 'dart');
  assert.equal(cfg.test, 'dart test');
  assert.deepEqual(cfg.mutation, MUTATION_NONE);
});

test('R11 — flutter cambia el comando de tests', async () => {
  const cfg = await detected({ 'pubspec.yaml': 'name: demo\ndependencies:\n  flutter:\n    sdk: flutter\n' });

  assert.equal(cfg.test, 'flutter test');
});

// ── Python ────────────────────────────────────────────────────────────────────────────────────

test('R11 — python + pytest', async () => {
  assert.deepEqual(await detected({ 'pyproject.toml': '[project]\nname = "demo"\n[tool.pytest.ini_options]\n' }), {
    stack: 'python',
    test: 'pytest',
    mutation: {
      tool: 'mutmut',
      command: 'mutmut run && mutmut junitxml > reports/mutation/mutmut.xml',
      report: 'reports/mutation/mutmut.xml',
      format: 'junit',
      install: 'uv add --dev mutmut',
      scopeFlag: '',
      threshold: 80,
      required: true
    },
    pending: []
  });
});

test('R11 — python sin pytest queda pendiente entero', async () => {
  const cfg = await detected({ 'requirements.txt': 'requests==2.31.0\n' });

  assert.equal(cfg.stack, 'python');
  assert.equal(cfg.test, '');
  assert.deepEqual(cfg.mutation, MUTATION_NONE);
  assert.deepEqual(cfg.pending, ['test.command', 'mutation.command']);
});

// ── Maven ─────────────────────────────────────────────────────────────────────────────────────

test('R11 — maven', async () => {
  assert.deepEqual(await detected({ 'pom.xml': '<project></project>\n' }), {
    stack: 'maven',
    test: 'mvn test',
    mutation: {
      tool: 'pit',
      command: 'mvn org.pitest:pitest-maven:mutationCoverage',
      report: 'target/pit-reports/**/mutations.xml',
      format: 'pit',
      install: '',
      scopeFlag: '',
      threshold: 80,
      required: true
    },
    pending: []
  });
});

// ── Rust y PHP: tests sí, mutación sin parser ─────────────────────────────────────────────────

test('R11 — rust', async () => {
  const cfg = await detected({ 'Cargo.toml': '[package]\nname = "demo"\n' });

  assert.equal(cfg.stack, 'rust');
  assert.equal(cfg.test, 'cargo test');
  assert.deepEqual(cfg.mutation, MUTATION_NONE);
});

test('R11 — php', async () => {
  const cfg = await detected({ 'composer.json': { name: 'demo/demo' } });

  assert.equal(cfg.stack, 'php');
  assert.equal(cfg.test, 'vendor/bin/phpunit');
  assert.deepEqual(cfg.mutation, MUTATION_NONE);
});

// ── sin stack ─────────────────────────────────────────────────────────────────────────────────

test('R11 — un repo sin señales no se asigna a ningún stack', async () => {
  assert.deepEqual(await detected({ 'LEEME.txt': 'hola\n' }), {
    stack: '',
    test: '',
    mutation: MUTATION_NONE,
    pending: ['test.command', 'mutation.command']
  });
});

// ── el orden importa ──────────────────────────────────────────────────────────────────────────

test('R11 — con señales de varios stacks gana js, como hoy', async () => {
  const cfg = await detected({
    'package.json': { name: 'a', devDependencies: { jest: '^29.0.0' }, scripts: { test: 'jest' } },
    'pom.xml': '<project></project>\n'
  });

  assert.equal(cfg.stack, 'js');
});
