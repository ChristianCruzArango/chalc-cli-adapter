// C-08 (spec 016, R23) — en Windows sin `wt`, el dashboard no informa de un éxito que no ocurrió:
// el ENOENT de spawn llega como EVENTO `error`, no como excepción, así que hay que esperar `spawn` o
// `error` antes de decidir. El fallo del puesto de mando usa su propia clave (no `dashNoBase`).

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { launchDetached } from '../lib/terminals.mjs';
import { DICT } from '../lib/i18n.mjs';

// spawn simulado: emite `spawn` o `error` en el siguiente tick, como hace Node.
function fakeSpawn(outcome, calls = []) {
  return (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    const child = new EventEmitter();
    child.unref = () => { child.unrefed = true; };
    calls.at(-1).child = child;
    setImmediate(() => (outcome === 'ok' ? child.emit('spawn') : child.emit('error', Object.assign(new Error('spawn wt ENOENT'), { code: 'ENOENT' }))));
    return child;
  };
}

test('R23: a missing wt resolves false (the ENOENT arrives as an event, not as an exception)', async () => {
  assert.equal(await launchDetached('wt', ['nt'], { spawnImpl: fakeSpawn('enoent') }), false);
});

test('R23: a launched wt resolves true, detached and unref-ed', async () => {
  const calls = [];
  assert.equal(await launchDetached('wt', ['nt', 'x'], { spawnImpl: fakeSpawn('ok', calls) }), true);
  assert.deepEqual(calls.map((c) => [c.cmd, c.args, c.opts.detached, c.opts.stdio]), [['wt', ['nt', 'x'], true, 'ignore']]);
  assert.equal(calls[0].child.unrefed, true);   // sin unref el CLI esperaría a la ventana de wt
});

test('R23: a spawn that throws synchronously resolves false too', async () => {
  assert.equal(await launchDetached('wt', [], { spawnImpl: () => { throw new Error('EINVAL'); } }), false);
});

test('R23: the command center failure has its own translated key, and the dashboard uses launchDetached', (ctx) => {
  assert.match(DICT.es.dashNoWindowsTerminal, /Windows Terminal/);
  assert.match(DICT.en.dashNoWindowsTerminal, /Windows Terminal/);
  const src = readFileSync(new URL('../lib/commands/dashboard.mjs', import.meta.url), 'utf8');
  // En el sandbox de Stryker el fuente está instrumentado: esta política sobre el texto solo vale en la suite normal.
  if (src.includes('stryMutAct_')) return ctx.skip('fuente instrumentado por Stryker');
  assert.doesNotMatch(src, /child\.on\('error', \(\) => console\.error\(c\.yellow\('! ' \+ t\('dashNoBase'\)\)\)\)/);
  // Los dos lanzamientos esperan el resultado, con launchDetached como lanzador real por defecto
  // (el comportamiento de cada uno se prueba en revision-c08-dashboard).
  assert.equal((src.match(/launch = launchDetached/g) || []).length, 2);
  assert.equal((src.match(/await launch\('wt'/g) || []).length, 2);
  assert.match(src, /t\('dashNoWindowsTerminal'\)/);
});
