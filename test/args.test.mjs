import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../lib/args.mjs';

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

test('parseArgs accepts QA security opt-ins', () => {
  const { flags } = parseArgs(['qa', '--allow-login', '--allow-external-login', '--screenshots']);
  assert.equal(flags['allow-login'], true);
  assert.equal(flags['allow-external-login'], true);
  assert.equal(flags.screenshots, true);
});
