// F-21 — la CLI responde a --help, a los atajos de una letra y a una flag desconocida sin trazas.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../lib/args.mjs';

const BIN = fileURLToPath(new URL('../bin/chalc.mjs', import.meta.url));
const run = (args) => spawnSync(process.execPath, [BIN, ...args], { cwd: mkdtempSync(join(tmpdir(), 'chalc-f21-')), encoding: 'utf8', input: '', timeout: 20000 });

test('--help and -h print the usage and exit 0', () => {
  for (const flag of ['--help', '-h']) {
    const r = run([flag]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /chalc \[/);
  }
});

test('an unknown flag shows the error and the usage, without a Node stack trace (exit 2)', () => {
  const r = run(['--no-existe']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--no-existe/);
  assert.doesNotMatch(r.stderr, /at .*\.mjs:\d+|file:\/\//);
});

test('-y is --yes and --skip-qa-inputs is a declared flag', () => {
  assert.deepEqual({ ...parseArgs(['-y', '--skip-qa-inputs']).flags }, { yes: true, 'skip-qa-inputs': true });
});

test('the docs no longer claim --lang changes the interface language', () => {
  const i18n = readFileSync(fileURLToPath(new URL('../lib/i18n.mjs', import.meta.url)), 'utf8');
  assert.doesNotMatch(i18n.split('\n').slice(0, 5).join('\n'), /bandera --lang\s+>/);
});
