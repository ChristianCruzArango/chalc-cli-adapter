import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../lib/cli/args.mjs';

test('parseArgs keeps positional values after boolean flags', () => {
  const { flags, positional } = parseArgs(['inspect', '--yes', 'prueba/angular']);

  assert.equal(flags.yes, true);
  assert.deepEqual(positional, ['inspect', 'prueba/angular']);
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
