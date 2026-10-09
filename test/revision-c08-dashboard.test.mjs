// C-08 (spec 016, R23) — `chalc dashboard` espera a saber si Windows Terminal arrancó antes de anunciar
// nada: el puesto de mando y la ventana aparte se prueban en proceso con el lanzador inyectado (sin abrir
// ventanas), comprobando qué se lanza y qué se informa en cada caso.

import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { t } from '../lib/i18n.mjs';
import { c } from '../lib/ansi.mjs';
import { commandCenterArgs, dashboardWindowArgs } from '../lib/terminals.mjs';
import { CHALC_ROOT } from '../lib/commands/context.mjs';
import { openCommandCenter, openWindow } from '../lib/commands/dashboard.mjs';

const BASE = join('/tmp', 'chalc-workspaces');
const childCmd = (port) => [process.execPath, join(CHALC_ROOT, 'bin', 'chalc.mjs'), 'dashboard', BASE, '--port', String(port), '--watch', '--no-console'];

// Lanzador falso: anota cada llamada y responde `ok`.
function fakeLaunch(ok) {
  const calls = [];
  return { calls, launch: async (cmd, args) => { calls.push([cmd, args]); return ok; } };
}

test('R23: the command center launches wt with the dashboard and one pane per workspace, then says so', async () => {
  const { calls, launch } = fakeLaunch(true);
  const out = []; const err = [];
  await openCommandCenter(BASE, 4321, { launch, scan: async () => [{ id: '001-a' }, { id: '002-b' }], print: (m) => out.push(m), warn: (m) => err.push(m) });
  assert.deepEqual(calls, [['wt', commandCenterArgs(childCmd(4321), [{ id: '001-a', dir: join(BASE, '001-a') }, { id: '002-b', dir: join(BASE, '002-b') }])]]);
  assert.deepEqual(out, [c.green('✓ ' + t('dashConsoleHint'))]);
  assert.deepEqual(err, []);
});

test('R23: without wt the command center reports its own failure and announces nothing', async () => {
  const { launch } = fakeLaunch(false);
  const out = []; const err = [];
  await openCommandCenter(BASE, 5000, { launch, scan: async () => [], print: (m) => out.push(m), warn: (m) => err.push(m) });
  assert.deepEqual(out, []);
  assert.deepEqual(err, [c.yellow('! ' + t('dashNoWindowsTerminal'))]);
});

test('R23: the separate window runs the watching child and announces its URL only once launched', async () => {
  const { calls, launch } = fakeLaunch(true);
  const out = [];
  assert.equal(await openWindow(BASE, 4400, { launch, print: (m) => out.push(m) }), true);
  assert.deepEqual(calls, [['wt', dashboardWindowArgs(childCmd(4400))]]);
  assert.deepEqual(out, [c.green('✓ ' + t('dashWindowHint', 'http://localhost:4400'))]);
});

test('R23: without wt the separate window returns false and prints nothing (the view paints here)', async () => {
  const { launch } = fakeLaunch(false);
  const out = [];
  assert.equal(await openWindow(BASE, 4400, { launch, print: (m) => out.push(m) }), false);
  assert.deepEqual(out, []);
});
