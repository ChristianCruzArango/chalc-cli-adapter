// S-11 — un proceso que ignora SIGTERM no puede colgar el CLI: tras el plazo llega SIGKILL.

import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execBounded } from '../cli/tools/shell.mjs';
import { tempDir } from './helpers/tmpdir.mjs';

test('a child that ignores SIGTERM is killed and the call resolves', { skip: process.platform === 'win32' }, async (tc) => {
  const dir = await tempDir(tc, 'chalc-s11-');
  await writeFile(join(dir, 'stubborn.mjs'), "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); console.log('up');");
  const start = Date.now();
  const r = await execBounded('node stubborn.mjs', { cwd: dir, timeoutMs: 300 });
  assert.equal(r.timedOut, true);
  assert.ok(Date.now() - start < 6000, `${Date.now() - start} ms`);
});

test('output over the limit stops the child and stops buffering', async (tc) => {
  const dir = await tempDir(tc, 'chalc-s11b-');
  await writeFile(join(dir, 'chatty.mjs'), "const s = 'x'.repeat(65536); setInterval(() => process.stdout.write(s), 1);");
  const r = await execBounded('node chatty.mjs', { cwd: dir, timeoutMs: 10000, maxBuffer: 256 * 1024 });
  assert.match(r.stderr, /output exceeded limit/);
  assert.ok(r.stdout.length < 1024 * 1024);
});
