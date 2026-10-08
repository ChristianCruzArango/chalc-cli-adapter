// F-05 — `--dry-run` simula de verdad o se rechaza antes de tocar nada; nunca se ignora en silencio.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../bin/chalc.mjs', import.meta.url));
const run = (args, cwd) => spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', input: '', env: { ...process.env, CHALC_LANG: 'es' }, timeout: 20000 });

test('commands without a simulation refuse --dry-run and write nothing', () => {
  for (const verb of ['feature', 'configure', 'update', 'spec', 'qa', 'deliver', 'install']) {
    const dir = mkdtempSync(join(tmpdir(), 'chalc-f05-'));
    const r = run([verb, '--dry-run'], dir);
    assert.equal(r.status, 2, `${verb}: ${r.stderr}`);
    assert.match(r.stderr, /--dry-run no está disponible|--dry-run is not available/);
    assert.deepEqual(readdirSync(dir), [], verb);
  }
});

test('apply --dry-run still shows the plan without writing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chalc-f05-apply-'));
  const r = run([dir, '--dry-run', '--yes'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readdirSync(dir), []);
});
