// Spec 027 (arranque limpio), T2 — el portón usa el gestor de paquetes del proyecto (R1–R4). El gestor y sus
// equivalencias son DATOS de la tabla de herramientas; el código no nombra ninguno.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { managerOf, rewriteCommands } from '../lib/pkgmanager.mjs';
import { detectGateConfig } from '../lib/gatedetect.mjs';

const SPEC = JSON.parse(await readFile(new URL('../catalog/tools/js.json', import.meta.url), 'utf8')).packageManagers;
const files = (...names) => (name) => names.includes(name);
const idOf = (input) => managerOf(SPEC, input)?.id ?? 'npm';

test('R1: el gestor sale del lockfile de la raíz', () => {
  assert.equal(idOf({ hasFile: files('pnpm-lock.yaml') }), 'pnpm');
  assert.equal(idOf({ hasFile: files('yarn.lock') }), 'yarn');
  assert.equal(idOf({ hasFile: files('bun.lockb') }), 'bun');
  assert.equal(idOf({ hasFile: files('bun.lock') }), 'bun');
  assert.equal(idOf({ hasFile: files('package-lock.json') }), 'npm');
  assert.equal(idOf({ hasFile: files() }), 'npm');
});

test('R1: el campo packageManager de package.json manda sobre cualquier lockfile', () => {
  const json = (value) => ({ 'package.json': { packageManager: value } });
  assert.equal(idOf({ json: json('pnpm@9.12.0'), hasFile: files('yarn.lock') }), 'pnpm');
  assert.equal(idOf({ json: json('yarn@4.5.0+sha512.abc'), hasFile: files() }), 'yarn');
  assert.equal(idOf({ json: json('npm@10.8.0'), hasFile: files('yarn.lock') }), 'npm', 'npm declarado: no se reescribe nada');
  assert.equal(idOf({ json: json(42), hasFile: files('pnpm-lock.yaml') }), 'pnpm', 'un valor que no es texto se ignora');
  assert.equal(idOf({ json: { 'package.json': null }, hasFile: files('bun.lock') }), 'bun');
});

test('R1: sin tabla de gestores (otros stacks) no hay gestor', () => {
  assert.equal(managerOf(undefined, { hasFile: files('pnpm-lock.yaml') }), null);
  assert.equal(managerOf({}, { hasFile: files('pnpm-lock.yaml') }), null);
});

const TOOLS = {
  test: 'npm test',
  build: { command: 'npm run build', install: 'npm i -D typescript' },
  mutation: { tool: 'stryker', command: 'npx --no-install stryker run', install: 'npm i -D @stryker-mutator/core @stryker-mutator/jest-runner', report: 'reports/mutation/mutation.json' }
};
const using = (id) => rewriteCommands(TOOLS, SPEC.managers.find((m) => m.id === id));

test('R2: los comandos de scripts y de instalación pasan al gestor detectado', () => {
  assert.deepEqual([using('pnpm').test, using('pnpm').build.command, using('pnpm').build.install], ['pnpm test', 'pnpm run build', 'pnpm add -D typescript']);
  assert.deepEqual([using('yarn').test, using('yarn').build.command, using('yarn').mutation.install], ['yarn test', 'yarn run build', 'yarn add -D @stryker-mutator/core @stryker-mutator/jest-runner']);
  assert.deepEqual([using('bun').test, using('bun').build.command, using('bun').build.install], ['bun run test', 'bun run build', 'bun add -d typescript']);
});

test('R3: lo que ejecuta un binario local queda igual, y el resto de campos no se toca', () => {
  for (const id of ['pnpm', 'yarn', 'bun']) {
    const out = using(id);
    assert.equal(out.mutation.command, 'npx --no-install stryker run', id);
    assert.equal(out.mutation.report, TOOLS.mutation.report);
    assert.equal(out.mutation.tool, 'stryker');
  }
});

test('R2: sin gestor (npm) las herramientas quedan idénticas, y nunca se muta la entrada', () => {
  assert.deepEqual(rewriteCommands(TOOLS, null), TOOLS);
  const before = JSON.stringify(TOOLS);
  using('pnpm');
  assert.equal(JSON.stringify(TOOLS), before);
  assert.deepEqual(rewriteCommands({ test: '', build: { command: '' }, mutation: null }, SPEC.managers[0]), { test: '', build: { command: '' }, mutation: null });
});

test('R2: solo se reescribe el comando que EMPIEZA por el del gestor', () => {
  const out = rewriteCommands({ test: 'cross-env CI=1 npm test', build: { command: 'npm run build' }, mutation: null }, SPEC.managers[0]);
  assert.equal(out.test, 'cross-env CI=1 npm test');
});

// ── en un proyecto de verdad ──────────────────────────────────────────────────────────────────────

async function project(t, { lock, pkg = {} } = {}) {
  const dir = await tempDir(t, 'chalc-027-pm-');
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts: { test: 'jest', build: 'tsc' }, devDependencies: { jest: '^29.0.0' }, ...pkg }));
  if (lock) await writeFile(join(dir, lock), '');
  return dir;
}

test('R2: gate.json de un proyecto pnpm lleva pnpm en tests, build e instalación; npx no cambia', async (t) => {
  const config = await detectGateConfig(await project(t, { lock: 'pnpm-lock.yaml' }));
  assert.equal(config.test.command, 'pnpm test');
  assert.equal(config.build.command, 'pnpm run build');
  assert.match(config.mutation.install, /^pnpm add -D @stryker-mutator\/core /);
  assert.equal(config.mutation.command, 'npx --no-install stryker run');
});

test('R2: un proyecto sin lockfile (o con el de npm) sigue recibiendo npm', async (t) => {
  for (const lock of [undefined, 'package-lock.json']) {
    const config = await detectGateConfig(await project(t, { lock }));
    assert.equal(config.test.command, 'npm test', String(lock));
    assert.equal(config.build.command, 'npm run build');
    assert.match(config.mutation.install, /^npm i -D /);
  }
});

test('R1: packageManager en package.json decide aunque no haya lockfile', async (t) => {
  const config = await detectGateConfig(await project(t, { pkg: { packageManager: 'yarn@4.5.0' } }));
  assert.equal(config.test.command, 'yarn test');
});
