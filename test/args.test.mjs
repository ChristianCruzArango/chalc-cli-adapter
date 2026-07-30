import test from 'node:test';
import assert from 'node:assert/strict';
import { npmConfigFlag, parseArgs } from '../lib/args.mjs';

test('parseArgs keeps positional values after boolean flags', () => {
  const { flags, positional } = parseArgs(['inspect', '--yes', 'test/fixtures/angular']);

  assert.equal(flags.yes, true);
  assert.deepEqual(positional, ['inspect', 'test/fixtures/angular']);
});

test('parseArgs supports repeated value flags', () => {
  const { flags, positional } = parseArgs(['--method', 'sdd:full', '--method=other', 'app']);

  assert.deepEqual(flags.method, ['sdd:full', 'other']);
  assert.deepEqual(positional, ['app']);
});

test('parseArgs rejects unknown flags and missing values', () => {
  assert.throws(() => parseArgs(['--wat']), /Flag desconocida/);
  assert.throws(() => parseArgs(['--target']), /necesita un valor/);
});

// spec 006 R11 — `npm run dashboard --console` sin `--`: npm se traga el flag y lo deja como
// npm_config_console en el entorno; chalc debe reconocerlo igual que --console.
test('npmConfigFlag reads flags swallowed by npm run from the environment', () => {
  assert.equal(npmConfigFlag('console', { npm_config_console: 'true' }), true);
  assert.equal(npmConfigFlag('console', { npm_config_console: 'false' }), false);
  assert.equal(npmConfigFlag('console', {}), false);
  assert.equal(npmConfigFlag('watch', { npm_config_console: 'true' }), false);
});

test('parseArgs maps --no-ccr to the ccr capability flag', () => {
  const { flags } = parseArgs(['--no-ccr']);
  assert.equal(flags.ccr, false);
});

test('parseArgs maps --no-ai to the ai capability flag', () => {
  const { flags } = parseArgs(['init', '--no-ai']);
  assert.equal(flags.ai, false);
});

test('parseArgs accepts --path as a value flag (chalc verify --path)', () => {
  const { flags } = parseArgs(['verify', '--path', 'mi-app']);
  assert.equal(flags.path, 'mi-app');
});

test('parseArgs accepts --ccr and --ai as positive booleans', () => {
  const { flags } = parseArgs(['--ccr', '--ai']);
  assert.equal(flags.ccr, true);
  assert.equal(flags.ai, true);
});

test('parseArgs accepts AI workflow flags', () => {
  const { flags } = parseArgs(['qa', '--repair-plan', '--profile', 'chalc-default', '--spec-model', 'gpt-x', '--qa-model', 'fast-x', '--repair-model', 'repair-x', '--architecture', 'modular-clean-architecture']);
  assert.equal(flags['repair-plan'], true);
  assert.equal(flags.profile, 'chalc-default');
  assert.equal(flags['spec-model'], 'gpt-x');
  assert.equal(flags['qa-model'], 'fast-x');
  assert.equal(flags['repair-model'], 'repair-x');
  assert.equal(flags.architecture, 'modular-clean-architecture');
});

test('parseArgs accepts deliver rerun flag', () => {
  const { flags, positional } = parseArgs(['deliver', '.', '--spec', '001-login', '--env', 'start', '--rerun']);
  assert.deepEqual(positional, ['deliver', '.']);
  assert.equal(flags.spec, '001-login');
  assert.equal(flags.env, 'start');
  assert.equal(flags.rerun, true);
});

// R2 (spec 003) — el repo móvil llega por --movil (o --mobile) con su ruta como valor, no como booleano.
test('parseArgs accepts --movil/--mobile as value flags (chalc feature)', () => {
  const { flags, positional } = parseArgs(['feature', 'web', '--back', 'api', '--movil', 'app']);
  assert.equal(flags.movil, 'app');
  assert.deepEqual(positional, ['feature', 'web']);

  const alias = parseArgs(['feature', 'web', '--back', 'api', '--mobile', 'app']);
  assert.equal(alias.flags.mobile, 'app');
});

test('parseArgs accepts QA security opt-ins', () => {
  const { flags } = parseArgs(['qa', '--allow-login', '--allow-external-login', '--screenshots']);
  assert.equal(flags['allow-login'], true);
  assert.equal(flags['allow-external-login'], true);
  assert.equal(flags.screenshots, true);
});

// spec 005 (R1, R12) — flags del modo worktree: booleanas --worktree/--terminals y --workspace-dir con valor.
test('parseArgs accepts the worktree-mode flags (spec 005)', () => {
  const { flags } = parseArgs(['feature', '--worktree', '--terminals', '--workspace-dir', 'D:/features']);
  assert.equal(flags.worktree, true);
  assert.equal(flags.terminals, true);
  assert.equal(flags['workspace-dir'], 'D:/features');
});

// spec 005 (R12) — --no-terminals apaga el lanzador en modo no interactivo.
test('parseArgs maps --no-terminals to terminals: false', () => {
  const { flags } = parseArgs(['feature', '--worktree', '--no-terminals']);
  assert.equal(flags.terminals, false);
});

// spec 006 (R10, R11) — flags del dashboard: --console (puesto de mando) y --no-watch (solo página).
test('parseArgs accepts the dashboard console/watch flags (spec 006)', () => {
  const { flags } = parseArgs(['dashboard', '--console', '--no-watch']);
  assert.equal(flags.console, true);
  assert.equal(flags.watch, false);
});
