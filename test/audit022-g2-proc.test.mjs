// T2 (spec 022, R17/R19, S9 Windows cwd + C6) — el entorno de los hijos que pasan por cmd.exe no
// resuelve ejecutables en el cwd del proyecto, y el rastreo de hijos vivos vive en un solo sitio.

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { windowsEnv, windowsSpawnOptions, trackChild, liveChildCount } from '../lib/proc.mjs';
import { execBounded, liveChildren } from '../cli/tools/shell.mjs';
import { envValue } from './helpers/envkey.mjs';

// T2 (spec 022, R17, S9 Windows cwd)
test('T2 (spec 022, R17, S9 Windows cwd): the cmd.exe child env never searches the current directory', () => {
  assert.equal(windowsEnv({ PATH: '/bin' }).NoDefaultCurrentDirectoryInExePath, '1');
  assert.equal(windowsEnv({ PATH: '/bin' }).PATH, '/bin');
  // Sin env explícito se hereda el del proceso, con la protección añadida.
  const inherited = windowsEnv(undefined);
  assert.equal(inherited.NoDefaultCurrentDirectoryInExePath, '1');
  assert.equal(envValue(inherited, 'PATH'), process.env.PATH);
  // Un env que intentara desactivarla no gana.
  assert.equal(windowsEnv({ NoDefaultCurrentDirectoryInExePath: '' }).NoDefaultCurrentDirectoryInExePath, '1');
});

test('T2 (spec 022, R17, S9 Windows cwd): Windows spawn options keep verbatim args and the hardened env', () => {
  const opts = windowsSpawnOptions({ cwd: '/p', env: { A: 'b' } });
  assert.equal(opts.windowsVerbatimArguments, true);
  assert.equal(opts.cwd, '/p');
  assert.deepEqual(opts.env, { A: 'b', NoDefaultCurrentDirectoryInExePath: '1' });
});

test('T2 (spec 022, R17, S9 Windows cwd): shell and MCP client build their Windows spawn through the shared helper', () => {
  for (const file of ['cli/tools/shell.mjs', 'cli/mcp/client.mjs']) {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(src, /windowsSpawnOptions|portable\(/, file);
  }
});

// T2 (spec 022, R19, C6)
test('T2 (spec 022, R19, C6): trackChild counts a live child until it exits', () => {
  const before = liveChildCount();
  const child = new EventEmitter();
  assert.equal(trackChild(child), child);
  assert.equal(liveChildCount(), before + 1);
  child.emit('exit', 0);
  assert.equal(liveChildCount(), before);
});

test('T2 (spec 022, R19, C6): no module keeps its own copy of the live-children set', () => {
  for (const file of ['cli/tools/shell.mjs', 'cli/mcp/client.mjs']) {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /const live = new Set\(\)/, file);
    assert.doesNotMatch(src, /process\.on\('exit'/, file);
  }
});

test('T2 (spec 022, R19, C6): a running shell child is tracked and released when it ends', async () => {
  // Sin `>` ni llaves: en Windows el hijo pasa por cmd.exe, que los toma como redirección o bloque. El hijo
  // se registra al lanzarlo (síncrono), así que se comprueba sin esperar a ciegas.
  const run = execBounded('node -e "setTimeout(Object,300)"', { cwd: process.cwd(), timeoutMs: 5000 });
  assert.ok(liveChildren() >= 1);
  const result = await run;
  assert.equal(result.code, 0, JSON.stringify(result));
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(liveChildren(), 0);
});
