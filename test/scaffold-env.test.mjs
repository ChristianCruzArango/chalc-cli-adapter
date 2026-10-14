// T4 (spec 022, R2, S2) — los procesos que lanzan `chalc init` y `chalc qa` no reciben credenciales.
// Se inyecta un spawn falso que captura el entorno: nunca se ejecuta un scaffolder ni un dev server real.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { childEnvForApp } from '../lib/childenv.mjs';
import { runInitStep } from '../lib/commands/init.mjs';
import { launch, runPlaywrightSpec } from '../lib/commands/qaenv.mjs';

const SECRETS = { CHALC_API_KEY: 'sk-x', CHALC_QA_TOKEN: 'tok', CHALC_QA_PASSWORD: 'pw', CHALC_QA_USER: 'qa@x', CHALC_PAT: 'pat', OPENROUTER_API_KEY: 'or' };

// Spawn falso: guarda las opciones y termina con código 0 en el siguiente tick.
function fakeSpawn() {
  const calls = [];
  const fn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => child.emit('exit', 0));
    return child;
  };
  return { fn, calls };
}

// Corre `body` con secretos en process.env y los retira al terminar.
async function withSecrets(extra, body) {
  const saved = {};
  const vars = { ...SECRETS, ...extra };
  for (const k of Object.keys(vars)) { saved[k] = process.env[k]; process.env[k] = vars[k]; }
  try { return await body(); } finally {
    for (const k of Object.keys(vars)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}

const assertNoSecrets = (env) => { for (const k of Object.keys(SECRETS)) assert.equal(env[k], undefined, `${k} llegó al hijo`); };

test('T4 (spec 022, R2, S2) childEnvForApp quita todo CHALC_* salvo CHALC_LANG y lo pedido en CHALC_PASS_ENV', () => {
  const env = childEnvForApp({ X: '1' }, { ...SECRETS, CHALC_LANG: 'es', CHALC_QA_BASE: 'u', PATH: '/bin', CHALC_PASS_ENV: 'CHALC_QA_BASE' });
  assertNoSecrets(env);
  assert.equal(env.CHALC_LANG, 'es');
  assert.equal(env.CHALC_QA_BASE, 'u');
  assert.equal(env.PATH, '/bin');
  assert.equal(env.X, '1');
});

test('T4 (spec 022, R2, S2) runInitStep no pasa credenciales al scaffolder', async () => {
  const { fn, calls } = fakeSpawn();
  await withSecrets({}, () => runInitStep({ command: 'npx', args: ['--yes', 'x'], cwd: 'parent' }, { parentDir: '/tmp', projectDir: '/tmp/p' }, { spawnFn: fn }));
  const env = calls[0].opts.env;
  assertNoSecrets(env);
  assert.equal(env.NG_CLI_ANALYTICS, 'false');
  assert.ok(env.PATH);
});

test('T4 (spec 022, R2, S2) el dev server de qa no recibe CHALC_* ni credenciales', async () => {
  const { fn, calls } = fakeSpawn();
  await withSecrets({ CHALC_LANG: 'en' }, async () => { launch({ command: 'npm', args: ['run', 'dev'] }, '/tmp', { spawnFn: fn }); });
  const env = calls[0].opts.env;
  assertNoSecrets(env);
  assert.equal(env.CHALC_LANG, 'en');
  assert.equal(env.NG_CLI_ANALYTICS, 'false');
});

test('T4 (spec 022, R2, S2) npx playwright test no recibe CHALC_* ni credenciales', async () => {
  const { fn, calls } = fakeSpawn();
  const code = await withSecrets({}, () => runPlaywrightSpec('/tmp', 'a.spec.ts', 'http://localhost:4200', { spawnFn: fn }));
  assert.equal(code, 0);
  const env = calls[0].opts.env;
  assertNoSecrets(env);
  assert.equal(env.PLAYWRIGHT_BASE_URL, 'http://localhost:4200');
  assert.equal(env.BASE_URL, 'http://localhost:4200');
});
