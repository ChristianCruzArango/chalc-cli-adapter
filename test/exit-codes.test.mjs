// F-12 — un fallo se refleja en el código de salida, con o sin `--strict`: en CI una entrega rota
// o una verificación fallida no pueden salir en verde.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDeliverVerifyStage } from '../lib/commands/deliver.mjs';

const BIN = fileURLToPath(new URL('../bin/chalc.mjs', import.meta.url));

test('chalc verify on a project that fails verification exits 1 without --strict', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chalc-f12-'));
  const r = spawnSync(process.execPath, [BIN, 'verify', dir], { encoding: 'utf8', input: '', timeout: 20000 });
  assert.equal(r.status, 1, r.stdout + r.stderr);
});

test('the deliver verify stage marks the process as failed when verification fails', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'chalc-f12-deliver-'));
  const previous = process.exitCode;
  const log = console.log;
  console.log = () => {};
  try {
    const ok = await runDeliverVerifyStage(dir);
    assert.equal(ok, false);
    assert.equal(process.exitCode, 1);
  } finally {
    console.log = log;
    process.exitCode = previous;
  }
});
