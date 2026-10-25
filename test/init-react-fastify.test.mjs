// T3 y T4 (spec 025, R9–R14) — `chalc init` crea proyectos React (Vite) y Fastify con su CLI oficial en una
// versión EXACTA, sugiere arquitectura como Angular y deja React con pruebas listas desde el primer día.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CREATE_VITE_NODE, FASTIFY_CLI_NODE, pickCliTag, resolveScaffoldTool, scaffoldToolSummary } from '../lib/init-cli.mjs';
import { archText, buildArchitectureDecision, getStack, listStacks, scaffoldSteps, suggestArchitectures, verifySteps } from '../lib/init.mjs';
import { REACT_TEST_FILES, REACT_TEST_PACKAGES } from '../lib/init-testkit.mjs';
import { reshapeProject, writeStarterFiles } from '../lib/init-scaffold.mjs';
import { gitignoreFor } from '../lib/init-gitignore.mjs';
import { windowsCommand } from '../lib/proc.mjs';
import { t } from '../lib/i18n.mjs';

const EXACT = /^\d+\.\d+\.\d+$/;

test('R9, R10: the scaffolder tables only hold exact versions', () => {
  for (const entry of [...CREATE_VITE_NODE, ...FASTIFY_CLI_NODE]) assert.match(entry.tag, EXACT);
});

test('R9: create-vite is picked for every Node that its engines accept', () => {
  for (const node of ['v20.19.0', 'v22.12.0', 'v24.15.0', 'v26.1.0']) assert.equal(pickCliTag(CREATE_VITE_NODE, node), '9.2.1', node);
});

test('R10: fastify-cli is picked for Node 20 and newer', () => {
  for (const node of ['v20.0.0', 'v22.20.0', 'v24.15.0']) assert.equal(pickCliTag(FASTIFY_CLI_NODE, node), '7.4.1', node);
});

test('R9, R10: an unsupported Node never falls back to latest, but to the newest exact version', () => {
  assert.equal(pickCliTag(CREATE_VITE_NODE, 'v18.20.0'), CREATE_VITE_NODE[0].tag);
  assert.equal(pickCliTag(FASTIFY_CLI_NODE, 'v18.20.0'), FASTIFY_CLI_NODE[0].tag);
});

test('R13: the init summary names the exact scaffolder package for react and fastify', () => {
  assert.deepEqual(resolveScaffoldTool('react', 'v22.20.0'), { pkg: 'create-vite', tag: '9.2.1' });
  assert.deepEqual(resolveScaffoldTool('fastify', 'v22.20.0'), { pkg: 'fastify-cli', tag: '7.4.1' });
  assert.deepEqual(scaffoldToolSummary('react', 'v22.20.0'), { spec: 'create-vite@9.2.1', note: t('initToolPinned', '22.20.0') });
  assert.deepEqual(scaffoldToolSummary('fastify', 'v24.15.0'), { spec: 'fastify-cli@7.4.1', note: t('initToolPinned', '24.15.0') });
});

test('R13: stacks without an npm scaffolder, or inherited object keys, resolve to no tool', () => {
  for (const stack of ['dotnet', 'flutter', 'toString', '__proto__']) assert.equal(resolveScaffoldTool(stack, 'v22.20.0'), null, stack);
});

// ---------- T4 ----------

test('R9, R10: init offers react and fastify next to the existing stacks', () => {
  assert.deepEqual(listStacks().map((s) => s.id), ['angular', 'nestjs', 'react', 'fastify', 'dotnet', 'flutter']);
});

test('R9: react is created by create-vite (React + TS) without prompts and without starting a dev server', () => {
  const [create] = scaffoldSteps('react', 'feature-first', 'web');
  assert.equal(create.command, 'npx');
  assert.deepEqual(create.args, ['--yes', 'create-vite@9.2.1', 'web', '--template', 'react-ts', '--no-interactive', '--no-immediate']);
  assert.equal(create.cwd, 'parent');
});

test('R12: react gets Vitest + Testing Library at exact versions and a `test` script', () => {
  const [, install, script] = scaffoldSteps('react', 'feature-first', 'web');
  assert.deepEqual(install.args, ['install', '--save-dev', '--save-exact', ...REACT_TEST_PACKAGES]);
  assert.equal(install.cwd, 'project');
  for (const pkg of REACT_TEST_PACKAGES) assert.match(pkg, /^(@[a-z-]+\/)?[a-z-]+@\d+\.\d+\.\d+$/, pkg);
  for (const name of ['vitest', '@testing-library/react', '@testing-library/dom', '@testing-library/jest-dom', 'jsdom']) {
    assert.ok(REACT_TEST_PACKAGES.some((pkg) => pkg.startsWith(`${name}@`)), name);
  }
  assert.equal(install.command, 'npm');
  assert.deepEqual([script.command, ...script.args], ['npm', 'pkg', 'set', 'scripts.test=vitest run']);
  assert.equal(script.cwd, 'project');
});

test('R10: fastify is created by fastify-cli generate with the TypeScript template', () => {
  const steps = scaffoldSteps('fastify', 'modular-plugins', 'api');
  assert.equal(steps.length, 1);
  assert.deepEqual([steps[0].command, ...steps[0].args], ['npx', '--yes', 'fastify-cli@7.4.1', 'generate', 'api', '--lang=ts']);
  assert.equal(steps[0].cwd, 'parent');
});

test('R14: --verify installs and builds (fastify-cli names its build script build:ts)', () => {
  assert.deepEqual(verifySteps('react').map((s) => [s.command, ...s.args]), [['npm', 'install'], ['npm', 'run', 'build']]);
  assert.deepEqual(verifySteps('fastify').map((s) => [s.command, ...s.args]), [['npm', 'install'], ['npm', 'run', 'build:ts']]);
});

test('R9, R10: every scaffold and verify step can run through cmd.exe on Windows', () => {
  for (const [stack, arch] of [['react', 'feature-first'], ['fastify', 'modular-plugins']]) {
    for (const step of [...scaffoldSteps(stack, arch, 'app'), ...verifySteps(stack)]) {
      assert.doesNotThrow(() => windowsCommand(step.command, step.args), `${stack}: ${step.args.join(' ')}`);
    }
  }
});

const recommended = (stack, proposal) => suggestArchitectures(stack, proposal).find((a) => a.recommended).id;
const signals = (...ids) => ({ complexity: ids.includes('domain') || ids.includes('enterprise') ? 'alta' : 'baja', signals: ids });

test('R11: react suggests feature-first, clean or enterprise like Angular', () => {
  assert.equal(recommended('react', signals()), 'feature-first');
  assert.equal(recommended('react', signals('domain')), 'clean-architecture');
  assert.equal(recommended('react', { complexity: 'media', signals: ['enterprise'] }), 'enterprise-modular');
});

test('R11: fastify suggests modular plugins, clean/hexagonal or enterprise like NestJS', () => {
  assert.equal(recommended('fastify', signals()), 'modular-plugins');
  assert.equal(recommended('fastify', signals('domain')), 'clean-hexagonal');
  assert.equal(recommended('fastify', signals('realtime')), 'enterprise-modular');
});

test('R11: each new architecture is bilingual and its folders live under src/', () => {
  for (const stack of ['react', 'fastify']) {
    assert.equal(getStack(stack).architectures.length, 3);
    for (const arch of getStack(stack).architectures) {
      for (const field of ['fit', 'tradeoff']) assert.ok(arch[field].es && arch[field].en, `${stack}/${arch.id}.${field}`);
      assert.ok(arch.folders.length && arch.folders.every((f) => f.startsWith('src/')), `${stack}/${arch.id}`);
    }
  }
});

async function reshapeTemp(stack, architectureId, existing = {}) {
  const dir = await mkdtemp(join(tmpdir(), `chalc-init-${stack}-`));
  for (const [rel, content] of Object.entries(existing)) {
    await mkdir(join(dir, rel, '..'), { recursive: true });
    await writeFile(join(dir, rel), content);
  }
  await reshapeProject(dir, buildArchitectureDecision({ stack, architectureId, contentLang: 'en' }));
  return dir;
}

test('R12: reshaping a react project writes the Vitest config, setup and a first passing test', async () => {
  const dir = await reshapeTemp('react', 'feature-first');
  for (const [rel, content] of Object.entries(REACT_TEST_FILES)) assert.equal(await readFile(join(dir, rel), 'utf8'), content, rel);
  assert.match(REACT_TEST_FILES['vitest.config.ts'], /mergeConfig\(viteConfig/);
  assert.match(REACT_TEST_FILES['src/test/setup.ts'], /@testing-library\/jest-dom\/vitest/);
});

test('R12: the test kit never overwrites a file the project already has', async () => {
  const dir = await reshapeTemp('react', 'feature-first', { 'vitest.config.ts': 'mine' });
  assert.equal(await readFile(join(dir, 'vitest.config.ts'), 'utf8'), 'mine');
});

test('R12: fastify brings its own test runner, so chalc adds no test kit', async () => {
  const dir = await reshapeTemp('fastify', 'modular-plugins');
  for (const rel of Object.keys(REACT_TEST_FILES)) assert.ok(!existsSync(join(dir, rel)), rel);
});

test('R11: a README the scaffolder left is kept; one chalc generated is refreshed', async () => {
  const dir = await reshapeTemp('fastify', 'modular-plugins', { 'src/plugins/README.md': '# Plugins (fastify-cli)' });
  assert.equal(await readFile(join(dir, 'src/plugins/README.md'), 'utf8'), '# Plugins (fastify-cli)');
  assert.match(await readFile(join(dir, 'src/modules/README.md'), 'utf8'), /chalc init/);
  await reshapeProject(dir, buildArchitectureDecision({ stack: 'fastify', architectureId: 'modular-plugins', contentLang: 'es' }));
  assert.match(await readFile(join(dir, 'src/modules/README.md'), 'utf8'), /Generado por chalc init/);
});

test('R9, R10: the .gitignore of react and fastify keeps dependencies, builds and coverage out', () => {
  for (const stack of ['react', 'fastify']) {
    for (const entry of ['node_modules/', 'dist/', 'coverage/', '*.tsbuildinfo']) assert.ok(gitignoreFor(stack).split('\n').includes(entry), `${stack}: ${entry}`);
  }
});

test('R9, R10, R11: stack, step and architecture labels are filled in both languages', () => {
  for (const stack of ['react', 'fastify']) {
    const { label, scaffold, verify, architectures } = getStack(stack);
    assert.ok(label, stack);
    const arch = architectures[0].id;
    for (const step of [...scaffold(arch), ...verify]) {
      const [es, en] = ['es', 'en'].map((code) => archText(step.label, code));
      assert.ok(es && en, `${stack}: ${step.command} ${step.args}`);
      if (typeof step.label === 'object') assert.notEqual(es, en, `${stack}: ${es}`);
    }
    for (const a of architectures) assert.ok(archText(a.label), `${stack}/${a.id}`);
  }
});

test('R11: complexity alone or a domain signal alone is enough for the clean architectures', () => {
  assert.equal(recommended('react', { complexity: 'alta', signals: [] }), 'clean-architecture');
  assert.equal(recommended('react', { complexity: 'baja', signals: ['domain'] }), 'clean-architecture');
  assert.equal(recommended('fastify', { complexity: 'alta', signals: [] }), 'clean-hexagonal');
  assert.equal(recommended('fastify', { complexity: 'baja', signals: ['domain'] }), 'clean-hexagonal');
  assert.equal(recommended('fastify', { complexity: 'baja', signals: ['enterprise'] }), 'enterprise-modular');
});

test('R12: the starter test imports its API from vitest, so it compiles with globals off', () => {
  assert.match(REACT_TEST_FILES['src/App.test.tsx'], /import \{ describe, expect, it \} from 'vitest'/);
});

test('R12: writeStarterFiles reports what it wrote, writes nothing twice and ignores stacks without a kit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-starter-'));
  assert.deepEqual(await writeStarterFiles(dir, 'react'), Object.keys(REACT_TEST_FILES));
  assert.deepEqual(await writeStarterFiles(dir, 'react'), []);
  assert.deepEqual(await writeStarterFiles(dir, 'fastify'), []);
  assert.deepEqual(await writeStarterFiles(dir, 'no-such-stack'), []);
});

test('R12: reshapeProject reports the starter files it wrote', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-reshape-'));
  const result = await reshapeProject(dir, buildArchitectureDecision({ stack: 'react', architectureId: 'feature-first', contentLang: 'en' }));
  assert.deepEqual(result.starterFiles, Object.keys(REACT_TEST_FILES));
});

test('R9, R10: the stack block of the .gitignore is exactly the agreed one', () => {
  for (const stack of ['react', 'fastify']) {
    const block = gitignoreFor(stack).split('\n\n')[0].split('\n').slice(1);
    assert.deepEqual(block, ['node_modules/', 'dist/', 'coverage/', '*.log', '*.tsbuildinfo'], stack);
  }
});
