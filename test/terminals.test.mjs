import test from 'node:test';
import assert from 'node:assert/strict';
import { wtArgs, openAllScript, launchTerminals, commandCenterArgs, dashboardWindowArgs } from '../lib/terminals.mjs';

const WS = [
  { id: '005-login', dir: 'D:\\features\\005-login' },
  { id: '006-reportes', dir: 'D:\\features\\006-reportes' }
];

// R12 — una sola ventana con TODAS las terminales visibles a la vez: la primera abre la ventana
// (nt) y cada workspace siguiente es un PANEL (sp), no una pestaña que haya que ir cambiando.
test('wtArgs opens one window with one PANE per workspace, all visible at once', () => {
  const args = wtArgs(WS);
  assert.deepEqual(args, [
    'nt', '--title', '005-login', '-d', 'D:\\features\\005-login', 'cmd',
    ';', 'sp', '--title', '006-reportes', '-d', 'D:\\features\\006-reportes', 'cmd'
  ]);
});

// R13 — en Windows el script reabre los mismos paneles con wt (`; escapado para PowerShell).
test('openAllScript for win32 writes an open-all.ps1 that calls wt with panes', () => {
  const s = openAllScript(WS, 'win32');
  assert.equal(s.name, 'open-all.ps1');
  assert.match(s.content, /wt nt --title "005-login" -d "D:\\features\\005-login" cmd/);
  assert.match(s.content, /`; sp --title "006-reportes"/);   // panel, no pestaña
  assert.match(s.content, /-d "D:\\features\\006-reportes" cmd/);   // shell cmd en cada panel
  assert.match(s.content, /`;/);   // separador escapado para PowerShell
});

// R13 — fuera de Windows: open-all.sh con las rutas (y sin sintaxis de wt).
test('openAllScript for other platforms writes an open-all.sh listing the workspaces', () => {
  const s = openAllScript(WS, 'linux');
  assert.equal(s.name, 'open-all.sh');
  assert.match(s.content, /^#!\/bin\/sh/);
  assert.match(s.content, /005-login/);
  assert.match(s.content, /006-reportes/);
  assert.doesNotMatch(s.content, /\bwt\b/);
});

// R12 — lanza wt UNA vez, desacoplado (detached) y sin ejecutar ningún agente en las pestañas.
test('launchTerminals spawns wt once with the tab args (spawn injectable)', () => {
  const calls = [];
  const fakeSpawn = (cmd, args, opts) => { calls.push({ cmd, args, opts }); return { unref() {}, on() {} }; };
  const res = launchTerminals(WS, { platform: 'win32', spawnImpl: fakeSpawn });
  assert.equal(res.ok, true);
  assert.equal(res.launched, 2);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, 'wt');
  assert.deepEqual(calls[0].args, wtArgs(WS));
  assert.equal(calls[0].opts.detached, true);
  // ninguna pestaña ejecuta un comando: solo título y directorio (el usuario escribe el agente)
  assert.ok(!calls[0].args.some((a) => /claude|codex|gemini/i.test(a)));
});

// spec 006 R11 — puesto de mando con layout fijo: el dashboard ocupa UN LADO completo (el
// primer workspace divide la ventana en vertical a la mitad) y los demás workspaces se APILAN
// en el otro lado (splits horizontales) a partes iguales. Sin comando en los paneles de trabajo.
test('commandCenterArgs: dashboard on one side, workspaces stacked evenly on the other', () => {
  const args = commandCenterArgs(['node', 'C:\\chalc\\bin\\chalc.mjs', 'dashboard', 'D:\\features'], WS);
  assert.deepEqual(args, [
    'nt', '--title', 'dashboard', 'node', 'C:\\chalc\\bin\\chalc.mjs', 'dashboard', 'D:\\features',
    ';', 'sp', '-V', '-s', '0.5', '--title', '005-login', '-d', 'D:\\features\\005-login', 'cmd',
    ';', 'sp', '-H', '-s', '0.5', '--title', '006-reportes', '-d', 'D:\\features\\006-reportes', 'cmd'
  ]);
  // solo el panel del dashboard lleva comando; los de trabajo, solo título y ruta
  assert.equal(args.filter((a) => a === 'sp').length, 2);
});

// R11 — con 3 workspaces el lado derecho queda en TERCIOS: el primer split horizontal cede 2/3
// al panel nuevo (que luego se parte a la mitad), dejando 1/3 - 1/3 - 1/3.
test('commandCenterArgs splits the workspace side into equal thirds for three workspaces', () => {
  const three = WS.concat([{ id: '007-perfil', dir: 'D:\\features\\007-perfil' }]);
  const args = commandCenterArgs(['node', 'bin.mjs', 'dashboard', 'D:\\features'], three);
  const sizes = [];
  for (let i = 0; i < args.length; i++) if (args[i] === '-s') sizes.push(args[i + 1]);
  assert.deepEqual(sizes, ['0.5', '0.67', '0.5']);
  assert.equal(args.filter((a) => a === '-V').length, 1);   // una sola división en columnas
  assert.equal(args.filter((a) => a === '-H').length, 2);   // el resto apila en el mismo lado
});

// spec 006 R10 — la vista viva abre en VENTANA APARTE: una ventana wt con un único panel
// corriendo el comando del dashboard (la terminal donde se ejecutó queda libre).
test('dashboardWindowArgs opens one wt window with a single pane running the dashboard', () => {
  const args = dashboardWindowArgs(['node', 'C:\\chalc\\bin\\chalc.mjs', 'dashboard', 'D:\\features']);
  assert.deepEqual(args, ['nt', '--title', 'dashboard', 'node', 'C:\\chalc\\bin\\chalc.mjs', 'dashboard', 'D:\\features']);
  assert.ok(!args.includes('sp'));   // sin paneles extra: solo la vista viva
});

// R12 — sin workspaces no hay nada que abrir: no se lanza wt.
test('launchTerminals with an empty list does not spawn anything', () => {
  const calls = [];
  const fakeSpawn = (...a) => { calls.push(a); return { unref() {}, on() {} }; };
  const res = launchTerminals([], { platform: 'win32', spawnImpl: fakeSpawn });
  assert.equal(res.ok, false);
  assert.equal(calls.length, 0);
});

// R13 — en SO sin Windows Terminal no se intenta lanzar nada: solo queda el script.
test('launchTerminals on non-win platforms does not spawn and reports ok:false', () => {
  const calls = [];
  const fakeSpawn = (...a) => { calls.push(a); return { unref() {}, on() {} }; };
  const res = launchTerminals(WS, { platform: 'linux', spawnImpl: fakeSpawn });
  assert.equal(res.ok, false);
  assert.equal(res.launched, 0);
  assert.equal(calls.length, 0);
});
