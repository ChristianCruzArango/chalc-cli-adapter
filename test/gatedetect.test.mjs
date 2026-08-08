// T1 (R2) — detección de la config del portón desde las señales REALES del repo.
// Regla dura de la spec: si algo no se puede determinar con certeza, el campo queda VACÍO y
// marcado como pendiente. Nunca un comando inventado ni una herramienta asumida por el lenguaje.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { detectGateConfig } from '../lib/gatedetect.mjs';

// Proyecto temporal con los archivos indicados: { 'ruta/relativa': 'contenido' }.
async function project(files = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-gate-detect-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, typeof content === 'string' ? content : JSON.stringify(content, null, 2), 'utf8');
  }
  return dir;
}

const pkg = (deps = {}, scripts = {}) => ({ name: 'x', devDependencies: deps, scripts });

// --- JS/TS: el runner sale del framework DETECTADO, no del lenguaje ---

test('detectGateConfig maps a jest project to the jest runner', async () => {
  const dir = await project({
    'package.json': pkg({ jest: '^29.0.0' }, { test: 'jest' }),
    'jest.config.js': 'module.exports = {};'
  });

  const cfg = await detectGateConfig(dir);

  assert.equal(cfg.test.command, 'npm test');
  assert.equal(cfg.mutation.tool, 'stryker');
  // `--no-install`: sin él npx descargaría la herramienta ausente, y el portón no instala nada.
  assert.equal(cfg.mutation.command, 'npx --no-install stryker run');
  assert.equal(cfg.mutation.probe, 'node_modules/.bin/stryker');
  assert.equal(cfg.mutation.report, 'reports/mutation/mutation.json');
  assert.equal(cfg.mutation.format, 'elements');
  assert.match(cfg.mutation.install, /@stryker-mutator\/jest-runner/);
  assert.deepEqual(cfg.pending, []);
});

test('detectGateConfig maps a karma/angular project to the karma runner', async () => {
  const dir = await project({
    'package.json': pkg({ '@angular/core': '^20.0.0', karma: '^6.4.0' }, { test: 'ng test' }),
    'karma.conf.js': 'module.exports = function () {};',
    'angular.json': { version: 1 }
  });

  const cfg = await detectGateConfig(dir);

  assert.equal(cfg.mutation.tool, 'stryker');
  assert.match(cfg.mutation.install, /@stryker-mutator\/karma-runner/);
  assert.equal(cfg.mutation.format, 'elements');
});

test('detectGateConfig maps a vitest project to the vitest runner', async () => {
  const dir = await project({
    'package.json': pkg({ vitest: '^2.0.0' }, { test: 'vitest run' }),
    'vitest.config.ts': 'export default {};'
  });

  const cfg = await detectGateConfig(dir);

  assert.equal(cfg.mutation.tool, 'stryker');
  assert.match(cfg.mutation.install, /@stryker-mutator\/vitest-runner/);
});

// --- otros stacks: herramienta y formato de reporte propios ---

test('detectGateConfig maps a .NET project to stryker-net', async () => {
  const dir = await project({
    'Api.csproj': '<Project Sdk="Microsoft.NET.Sdk"></Project>',
    'Api.sln': ''
  });

  const cfg = await detectGateConfig(dir);

  assert.equal(cfg.test.command, 'dotnet test');
  assert.equal(cfg.mutation.tool, 'stryker-net');
  assert.equal(cfg.mutation.command, 'dotnet stryker');
  assert.equal(cfg.mutation.format, 'elements');
  assert.match(cfg.mutation.report, /mutation-report\.json$/);
  assert.match(cfg.mutation.install, /dotnet tool install/);
});

test('detectGateConfig maps a pytest project to mutmut with a junit report', async () => {
  const dir = await project({
    'pyproject.toml': '[project]\nname = "x"\n\n[dependency-groups]\ndev = ["pytest"]\n'
  });

  const cfg = await detectGateConfig(dir);

  assert.equal(cfg.test.command, 'pytest');
  assert.equal(cfg.mutation.tool, 'mutmut');
  assert.equal(cfg.mutation.format, 'junit');
});

test('detectGateConfig maps a maven project to PIT', async () => {
  const dir = await project({ 'pom.xml': '<project><artifactId>x</artifactId></project>' });

  const cfg = await detectGateConfig(dir);

  assert.equal(cfg.test.command, 'mvn test');
  assert.equal(cfg.mutation.tool, 'pit');
  assert.equal(cfg.mutation.format, 'pit');
  assert.match(cfg.mutation.report, /mutations\.xml$/);
});

// --- la regla dura: sin certeza, campo vacío y PENDIENTE (nunca inventar) ---

test('detectGateConfig leaves mutation pending for a stack with no standard tool', async () => {
  const dir = await project({
    'pubspec.yaml': 'name: x\ndev_dependencies:\n  flutter_test:\n    sdk: flutter\n'
  });

  const cfg = await detectGateConfig(dir);

  assert.equal(cfg.test.command, 'flutter test');       // los tests SÍ se saben
  assert.equal(cfg.mutation.tool, '');                  // la mutación no: Dart no tiene herramienta estándar
  assert.equal(cfg.mutation.command, '');
  assert.ok(cfg.pending.includes('mutation.command'));
  assert.ok(!cfg.pending.includes('test.command'));
});

test('detectGateConfig marks the test command pending when the project has no test setup', async () => {
  const dir = await project({ 'README.md': '# vacío' });

  const cfg = await detectGateConfig(dir);

  assert.equal(cfg.test.command, '');
  assert.equal(cfg.mutation.command, '');
  assert.ok(cfg.pending.includes('test.command'));
  assert.ok(cfg.pending.includes('mutation.command'));
});

test('detectGateConfig does not take npm\'s placeholder test script as a real test command', async () => {
  const dir = await project({
    'package.json': pkg({}, { test: 'echo "Error: no test specified" && exit 1' })
  });

  const cfg = await detectGateConfig(dir);

  assert.equal(cfg.test.command, '');
  assert.ok(cfg.pending.includes('test.command'));
});

test('detectGateConfig leaves the runner pending when the JS framework is ambiguous', async () => {
  // Sin framework de test detectable no se puede elegir runner: Stryker sin runner no corre.
  const dir = await project({ 'package.json': pkg({ typescript: '^5.0.0' }, { test: 'node --test' }) });

  const cfg = await detectGateConfig(dir);

  assert.equal(cfg.test.command, 'npm test');
  assert.equal(cfg.mutation.tool, '');
  assert.equal(cfg.mutation.command, '');
  assert.ok(cfg.pending.includes('mutation.command'));
});

// --- resto de la config: defaults y datos que vienen del llamador ---

test('detectGateConfig fills defaults and carries role and language from the caller', async () => {
  const dir = await project({ 'package.json': pkg({ jest: '^29.0.0' }, { test: 'jest' }) });

  const cfg = await detectGateConfig(dir, { role: 'back', language: 'español' });

  assert.equal(cfg.mutation.threshold, 80);
  assert.equal(cfg.spec.dir, 'specs');
  assert.equal(cfg.role, 'back');
  assert.equal(cfg.language, 'español');
  assert.equal(typeof cfg.lint.maxFileLines, 'number');
  assert.equal(typeof cfg.lint.maxFunctionLines, 'number');
  assert.equal(typeof cfg.lint.maxParams, 'number');
  assert.equal(typeof cfg.lint.maxDepth, 'number');
});
