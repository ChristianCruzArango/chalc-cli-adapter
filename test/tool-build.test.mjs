// T7 (spec 018, R3) — chalc detecta con qué se compila cada stack.
//
// La etapa `build` del portón (T5) solo sirve si `gate.json` trae el comando. Por stack es un dato fijo
// salvo en JS/TS, donde depende del repo: el script `build` si lo hay (cubre `ng build` y `nest build`,
// lo mismo que ya usa `chalc init --verify`), si no `tsc --noEmit` cuando hay `tsconfig.json`, y si no
// nada —un JS sin build ni tsconfig no tiene qué compilar—. Esa forma «el primero que aplique» no la
// expresaba ninguna regla de la tabla: `firstOf` es la quinta, con su test (toolrules.mjs lo pide).

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolve, RULE_NAMES } from '../lib/toolrules.mjs';
import { detectGateConfig, pendingKeys } from '../lib/gatedetect.mjs';
import { resolveTools } from '../lib/tooltable.mjs';
import { detectContext } from '../lib/detect.mjs';

const input = { json: { 'package.json': { scripts: { build: 'nest build' } } }, signals: {}, deps: {}, entries: ['tsconfig.json'] };

// ── la regla ──────────────────────────────────────────────────────────────────────────────────

test('R3: firstOf is a rule of the table', () => {
  assert.ok(RULE_NAMES.includes('firstOf'));
});

test('R3: firstOf returns the first sub-rule that resolves', () => {
  const rule = { rule: 'firstOf', rules: [{ rule: 'fixed' }, { rule: 'fixed', value: 'a' }, { rule: 'fixed', value: 'b' }] };
  assert.equal(resolve(rule, input), 'a');
});

test('R3: firstOf without any resolving sub-rule gives its default, or unresolved', () => {
  assert.equal(resolve({ rule: 'firstOf', rules: [{ rule: 'nope' }], default: '' }, input), '');
  assert.equal(resolve({ rule: 'firstOf', rules: [{ rule: 'fixed' }] }, input), null);
  assert.equal(resolve({ rule: 'firstOf' }, input), null);
});

// ── la tabla, por stack ───────────────────────────────────────────────────────────────────────

async function repo(files) {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-tool-build-'));
  for (const [rel, content] of Object.entries(files)) {
    await mkdir(dirname(join(dir, rel)), { recursive: true });
    await writeFile(join(dir, rel), typeof content === 'string' ? content : JSON.stringify(content), 'utf8');
  }
  return dir;
}
const buildOf = async (files) => (await detectGateConfig(await repo(files))).build;

const TSC = { command: 'npx --no-install tsc --noEmit -p tsconfig.json', probe: 'node_modules/.bin/tsc', install: 'npm i -D typescript' };

test('R3: js with a build script compiles with npm run build', async () => {
  assert.deepEqual(await buildOf({ 'package.json': { scripts: { build: 'nest build', test: 'vitest run' } }, 'tsconfig.json': '{}' }), { command: 'npm run build' });
});

test('R3: js without a build script but with tsconfig.json type-checks with tsc, without downloading it', async () => {
  assert.deepEqual(await buildOf({ 'package.json': { scripts: { test: 'node --test' } }, 'tsconfig.json': '{}' }), TSC);
});

test('R3: plain js with nothing to compile has an empty build command, and it is not pending', async () => {
  const dir = await repo({ 'package.json': { scripts: { test: 'node --test' } } });
  const config = await detectGateConfig(dir);
  assert.deepEqual(config.build, { command: '' });
  assert.ok(!pendingKeys(config).includes('build.command'));
});

test('R3: an empty build script does not count', async () => {
  assert.deepEqual(await buildOf({ 'package.json': { scripts: { build: '  ', test: 'x' } } }), { command: '' });
});

test('R3: each compiled stack gets its own build command', async () => {
  assert.deepEqual(await buildOf({ 'api.csproj': '<Project/>' }), { command: 'dotnet build --nologo' });
  assert.deepEqual(await buildOf({ 'pom.xml': '<project/>' }), { command: 'mvn -q compile' });
  assert.deepEqual(await buildOf({ 'Cargo.toml': '[package]' }), { command: 'cargo check' });
  assert.deepEqual(await buildOf({ 'pubspec.yaml': 'dependencies:\n  flutter:\n    sdk: flutter\n' }), { command: 'flutter analyze --no-fatal-warnings --no-fatal-infos' });
  assert.deepEqual(await buildOf({ 'pubspec.yaml': 'name: lib\n' }), { command: 'dart analyze --no-fatal-warnings --no-fatal-infos' });
});

test('R3: interpreted stacks have nothing to compile', async () => {
  assert.deepEqual(await buildOf({ 'pyproject.toml': '[project]' }), { command: '' });
  assert.deepEqual(await buildOf({ 'composer.json': '{}' }), { command: '' });
});

// Los casos de abajo salen de la pasada de mutación.

test('R3: a JSON that only a rule nested in firstOf reads is still read', async () => {
  const dir = await repo({ 'app.json': { compile: 'yes' } });
  const stack = {
    test: { rule: 'fixed', value: 'x' },
    build: { rule: 'firstOf', rules: [{ rule: 'firstOf' }, { rule: 'jsonField', file: 'app.json', path: 'compile', value: { command: 'make' } }] }
  };
  const tools = await resolveTools(stack, dir, await detectContext(dir));
  assert.deepEqual(tools.build, { command: 'make' });
});

test('R3: a stack without build in its table, and a repo without any stack, have nothing to compile', async () => {
  const dir = await repo({ 'notas.txt': 'nada' });
  assert.deepEqual((await resolveTools({ test: { rule: 'fixed', value: 'x' } }, dir, await detectContext(dir))).build, { command: '' });
  assert.deepEqual((await detectGateConfig(dir)).build, { command: '' });
});
