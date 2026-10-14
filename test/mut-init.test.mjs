// T10 (spec 022, R9, S2) — mutantes: el scaffolder de `chalc init` corre con salida visible y entorno
// limpio, la versión de Flutter se lee sin credenciales, el resumen muestra la versión exacta del CLI
// y la tabla Node→CLI elige el major correcto. Sin procesos reales: spawn se inyecta.

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { detectFlutterVersion, printToolchain, runInitStep } from '../lib/commands/init.mjs';
import { c } from '../lib/commands/context.mjs';
import { ANGULAR_CLI_NODE, NEST_CLI_NODE, pickCliTag, scaffoldToolSummary } from '../lib/init-cli.mjs';
import { t } from '../lib/i18n.mjs';

const IS_WINDOWS = process.platform === 'win32';

// Spawn falso: guarda la llamada, emite `stdout` y termina con `exit`.
function fakeSpawn({ stdout = '', fail = false } = {}) {
  const calls = [];
  const fn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    setImmediate(() => {
      if (fail) { child.emit('error', new Error('ENOENT')); return; }
      if (stdout) child.stdout.emit('data', stdout);
      child.emit('exit', 0);
    });
    return child;
  };
  return { fn, calls };
}

test('runInitStep hereda la terminal (salida visible) y corre en la carpeta pedida', async () => {
  const { fn, calls } = fakeSpawn();
  const res = await runInitStep({ command: 'npx', args: ['x'], cwd: 'project' }, { parentDir: '/p', projectDir: '/p/app' }, { spawnFn: fn });
  assert.deepEqual(res, { code: 0 });
  if (!IS_WINDOWS) assert.equal(calls[0].opts.stdio, 'inherit');
  assert.equal(calls[0].opts.cwd, '/p/app');
});

test('detectFlutterVersion lee la versión de `flutter --version` sin pasar credenciales', async () => {
  const { fn, calls } = fakeSpawn({ stdout: 'Flutter 3.24.1 • channel stable' });
  const saved = process.env.CHALC_API_KEY;
  process.env.CHALC_API_KEY = 'sk-secreta';
  try {
    assert.equal(await detectFlutterVersion({ spawnFn: fn }), '3.24.1');
  } finally {
    if (saved === undefined) delete process.env.CHALC_API_KEY; else process.env.CHALC_API_KEY = saved;
  }
  assert.equal(calls[0].opts.env.CHALC_API_KEY, undefined);
  assert.ok(calls[0].opts.env.PATH !== undefined || IS_WINDOWS);
  if (!IS_WINDOWS) {
    assert.equal(calls[0].cmd, 'flutter');
    assert.deepEqual(calls[0].args, ['--version']);
    assert.deepEqual(calls[0].opts.stdio, ['ignore', 'pipe', 'ignore']);
  }
});

test('detectFlutterVersion devuelve null si flutter no está o no imprime versión', async () => {
  assert.equal(await detectFlutterVersion({ spawnFn: fakeSpawn({ fail: true }).fn }), null);
  assert.equal(await detectFlutterVersion({ spawnFn: fakeSpawn({ stdout: 'nada' }).fn }), null);
});

test('printToolchain muestra el paquete exacto y la nota; nada para un stack sin CLI', () => {
  const lines = [];
  printToolchain('angular', (l) => lines.push(l));
  const tool = scaffoldToolSummary('angular');
  assert.deepEqual(lines, [`  ${t('initSumToolchain')}: ${tool.spec}` + c.dim('  · ' + tool.note)]);
  const none = [];
  printToolchain('dotnet', (l) => none.push(l));
  assert.deepEqual(none, []);
});

test('pickCliTag: cada rama de Node de la tabla de Angular elige su CLI', () => {
  assert.equal(pickCliTag(ANGULAR_CLI_NODE, 'v18.19.1'), '19.2.27');
  assert.equal(pickCliTag(ANGULAR_CLI_NODE, 'v18.20.0'), '19.2.27');
  assert.equal(pickCliTag(ANGULAR_CLI_NODE, 'v20.11.1'), '19.2.27');
  assert.equal(pickCliTag(ANGULAR_CLI_NODE, 'v20.19.0'), '20.3.39');
  assert.equal(pickCliTag(ANGULAR_CLI_NODE, 'v18.19.0'), '22.2.2');   // ninguna encaja: la más nueva
});

test('pickCliTag: cada rama de Node de la tabla de Nest elige su CLI', () => {
  assert.equal(pickCliTag(NEST_CLI_NODE, 'v20.11.0'), '11.0.24');
  assert.equal(pickCliTag(NEST_CLI_NODE, 'v20.10.0'), '10.4.9');
  assert.equal(pickCliTag(NEST_CLI_NODE, 'v16.14.0'), '10.4.9');
  assert.equal(pickCliTag(NEST_CLI_NODE, 'v16.13.0'), '11.0.24');
});

test('pickCliTag y la nota solo quitan la `v` inicial de la versión de Node', () => {
  // "2v0.19.0" no es un Node válido: no encaja en ninguna rama (no se lee como 20.19.0).
  assert.equal(pickCliTag(ANGULAR_CLI_NODE, '2v0.19.0'), '22.2.2');
  assert.equal(scaffoldToolSummary('angular', '2v0.19.0').note, t('initToolPinned', '2v0.19.0'));
  assert.equal(scaffoldToolSummary('angular', 'v22.22.3').note, t('initToolPinned', '22.22.3'));
});
