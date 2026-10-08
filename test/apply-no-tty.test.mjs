// F-14 — sin terminal, `chalc` no equipa el directorio actual sin un `--yes` explícito.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../bin/chalc.mjs', import.meta.url));
const run = (args, cwd) => spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', input: '', timeout: 30000 });

function project() {
  const dir = mkdtempSync(join(tmpdir(), 'chalc-f14-'));
  writeFileSync(join(dir, 'package.json'), '{"name":"x"}');
  return dir;
}

test('without a TTY and without --yes nothing is written and the exit code is 2', () => {
  const dir = project();
  const r = run([], dir);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /--yes/);
  assert.deepEqual(readdirSync(dir), ['package.json']);
});

test('with --yes the project is equipped as before', () => {
  const dir = project();
  const r = run(['--yes'], dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(readdirSync(dir).length > 1);
});
