// F-13 — los comandos terminan con un código SIN `process.exit`: el log de tokens se guarda siempre
// y no se mata el proceso a mitad de una petición.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CommandExit, exitCommand } from '../lib/commands/exit.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

test('no command module calls process.exit directly', async () => {
  const dir = join(ROOT, 'lib', 'commands');
  const offenders = [];
  for (const f of await readdir(dir)) {
    const src = await readFile(join(dir, f), 'utf8');
    if (/process\.exit\(/.test(src)) offenders.push(f);
  }
  assert.deepEqual(offenders, []);
});

test('exitCommand throws a CommandExit carrying the code', () => {
  assert.throws(() => exitCommand(2), (e) => e instanceof CommandExit && e.exitCode === 2);
});

test('the entrypoint turns a CommandExit into the process exit code, without a stack trace', () => {
  const missing = join(mkdtempSync(join(tmpdir(), 'chalc-f13-')), 'no-existe');
  const r = spawnSync(process.execPath, [join(ROOT, 'bin', 'chalc.mjs'), 'inspect', missing], { encoding: 'utf8', input: '', timeout: 20000 });
  assert.equal(r.status, 1);
  assert.doesNotMatch(r.stderr, /CommandExit|at .*\.mjs:\d+/);
});
