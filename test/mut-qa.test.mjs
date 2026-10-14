// T10 (spec 022, R2 S2 · R17 S9 · R18 F10) — mutantes: el QA (entorno, auth, plan, replay, agente, login)
// y el entorno de los procesos hijos. Sin red ni IA: spawn y fetch falsos, chat simulado.

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { lang, t } from '../lib/i18n.mjs';
import { launch, runPlaywrightSpec, runToEnd } from '../lib/commands/qaenv.mjs';
import { prepareAgentAuth } from '../lib/commands/qaauth.mjs';
import { agentPlan, authNote } from '../lib/commands/qaagentrun.mjs';
import { buildQaPlan, buildBrowserTests, qaPlanPath } from '../lib/qa.mjs';
import { renderReplaySpec } from '../lib/qa/browser.mjs';
import { qaText } from '../lib/qa/common.mjs';
import { httpExecutor, runQaAgent } from '../lib/qaagent.mjs';
import { writeQaReplaySpecArtifact } from '../lib/qaflow.mjs';
import { secretQueryFields, validateLoginEndpoint } from '../lib/qalogin.mjs';
import { childEnvForApp } from '../lib/childenv.mjs';

const POSIX = process.platform !== 'win32';

// Spawn falso: guarda la llamada y sale con `code` en el siguiente tick.
function fakeSpawn(code = 0) {
  const calls = [];
  const fn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => child.emit('exit', code));
    return child;
  };
  return { fn, calls };
}

// Captura console.log mientras corre `body`.
async function captureLogs(body) {
  const logs = [];
  const original = console.log;
  console.log = (...a) => logs.push(a.join(' '));
  try { await body(); } finally { console.log = original; }
  return logs;
}

// ── qaenv ────────────────────────────────────────────────────────────────────────────────────────
test('launch: el dev server recibe su comando, cwd, stdio con pipes y grupo propio en POSIX', { skip: !POSIX }, () => {
  const { fn, calls } = fakeSpawn();
  launch({ command: 'npm', args: ['run', 'dev'] }, '/proj', { spawnFn: fn });
  assert.equal(calls[0].cmd, 'npm');
  assert.deepEqual(calls[0].args, ['run', 'dev']);
  assert.equal(calls[0].opts.cwd, '/proj');
  assert.deepEqual(calls[0].opts.stdio, ['ignore', 'pipe', 'pipe']);
  assert.equal(calls[0].opts.detached, true);
});

test('launch: en Windows el dev server no se lanza detached', { skip: !POSIX }, () => {
  const { fn, calls } = fakeSpawn();
  const saved = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { ...saved, value: 'win32' });
  try { launch({ command: 'npm', args: ['start'] }, '/proj', { spawnFn: fn }); }
  finally { Object.defineProperty(process, 'platform', saved); }
  assert.equal(calls[0].opts.detached, false);
});

test('runPlaywrightSpec: npx playwright test <spec> --reporter=line en el proyecto', { skip: !POSIX }, async () => {
  const { fn, calls } = fakeSpawn(3);
  assert.equal(await runPlaywrightSpec('/proj', 'qa/e2e/a.spec.mjs', 'http://localhost:1', { spawnFn: fn }), 3);
  assert.equal(calls[0].cmd, 'npx');
  assert.deepEqual(calls[0].args, ['playwright', 'test', 'qa/e2e/a.spec.mjs', '--reporter=line']);
  assert.equal(calls[0].opts.cwd, '/proj');
});

test('runToEnd: corre el down en el proyecto, sin salida y sin credenciales; devuelve el exit code', { skip: !POSIX }, async () => {
  const { fn, calls } = fakeSpawn(7);
  process.env.CHALC_QA_TOKEN = 'secreto';
  try { assert.equal(await runToEnd('docker', ['compose', 'down'], '/proj', fn), 7); }
  finally { delete process.env.CHALC_QA_TOKEN; }
  assert.equal(calls[0].cmd, 'docker');
  assert.deepEqual(calls[0].args, ['compose', 'down']);
  assert.equal(calls[0].opts.cwd, '/proj');
  assert.equal(calls[0].opts.stdio, 'ignore');
  assert.equal(calls[0].opts.env.CHALC_QA_TOKEN, undefined);
  assert.ok(calls[0].opts.env.PATH);
});

// ── qaauth: aviso del secreto en la query ────────────────────────────────────────────────────────
async function loginAttempt(t, contract) {
  const proj = await tempDir(t);
  await writeFile(join(proj, '.chalc.json'), JSON.stringify({ qa: { login: contract } }));
  const prompter = { yesno: async () => false };
  return captureLogs(() => assert.rejects(() => prepareAgentAuth(prompter, proj, null, {})));
}
const contract = (query) => ({
  url: 'http://localhost:3000/login', method: 'GET', query,
  fields: [{ name: 'usuario' }, { name: 'clave', secret: true }, { name: 'pin', secret: true }],
  tokenPath: 'token'
});

test('qaauth: sin secretos en la query no hay aviso', async (t) => {
  const logs = await loginAttempt(t, contract({ user: '${usuario}' }));
  assert.deepEqual(logs.filter((l) => l.includes('⚠')), []);
});

test('qaauth: el aviso nombra todos los secretos de la query, separados por coma', async (tc) => {
  const logs = await loginAttempt(tc, contract({ user: '${usuario}', pass: '${clave}', p: '${pin}' }));
  assert.ok(logs.some((l) => l.includes('⚠ ' + t('qaLoginSecretInQuery', 'clave, pin'))), logs.join('\n'));
});

// ── qaagentrun: el plan del agente ───────────────────────────────────────────────────────────────
test('agentPlan: sin sesión es el plan tal cual; con sesión lleva la nota delante, separada por una línea', async (t) => {
  const proj = await tempDir(t);
  const context = { id: '001-x', files: { 'spec.md': '- **R1** algo' } };
  assert.equal(await agentPlan(proj, context, null), '- **R1** algo');
  const auth = { headers: { Authorization: 'Bearer x' } };
  assert.equal(await agentPlan(proj, context, auth), `${authNote(auth)}\n\n- **R1** algo`);
});

// ── qa.mjs: plan y tests del wizard ──────────────────────────────────────────────────────────────
const ctx = { id: '007-demo', files: { 'spec.md': '- **R1** — Ver el total | con IVA\n- **R2** — Guardar' } };

test('buildQaPlan: estructura completa, con la barra del criterio escapada', () => {
  const f = qaText('en');
  const plan = buildQaPlan(ctx, { command: 'npm run dev', type: 'npm' }, { specLang: 'en' });
  assert.equal(plan, [
    f.planTitle('007-demo'), '', f.planFromSpec, f.planResolveFirst, '', f.planLaunchL('`npm run dev` (npm)'), '',
    f.planTraceH, '', f.planTableHead, '|---|---|---|---|',
    `| R1 | Ver el total \\| con IVA | ${f.planStrategyPending} | PENDING |`,
    `| R2 | Guardar | ${f.planStrategyPending} | PENDING |`,
    '', f.planQuestionsH, '', f.planQData, f.planQUrl, f.planQObservable, ''
  ].join('\n'));
});

test('sin specLang, plan, tests y replay salen en el idioma de la interfaz', () => {
  const ui = { specLang: lang };
  assert.equal(buildQaPlan(ctx, null), buildQaPlan(ctx, null, ui));
  assert.equal(buildBrowserTests(ctx), buildBrowserTests(ctx, {}, ui));
  assert.equal(renderReplaySpec({ specId: 'x', steps: [] }), renderReplaySpec({ specId: 'x', steps: [], ...ui }));
  assert.equal(qaText(), qaText(lang));
});

// ── qa/browser: replay ───────────────────────────────────────────────────────────────────────────
const browserStep = (steps) => ({ action: { type: 'browser', requirement: 'R1', ...(steps ? { steps } : {}) }, observation: { ok: true } });

test('replay: cada paso va indentado dentro del test y una op desconocida se nombra', () => {
  const spec = renderReplaySpec({ specId: 'x', baseUrl: 'http://a', steps: [browserStep([{ op: 'hover' }])], specLang: 'en' });
  assert.ok(spec.split('\n').includes('  ' + qaText('en').replayUnknownOp('"hover"')), spec);
});

test('replay: una acción de navegador sin `steps` deja el test vacío', () => {
  const lines = renderReplaySpec({ specId: 'x', baseUrl: 'http://a', steps: [browserStep(null)], specLang: 'en' }).split('\n');
  const at = lines.findIndex((l) => l.startsWith('test("R1"'));
  assert.equal(lines[at + 1], '});');
});

// ── qaagent ──────────────────────────────────────────────────────────────────────────────────────
test('runQaAgent: el primer turno avisa que no hay observaciones y el presupuesto dice los pasos que quedan', async () => {
  const turns = [];
  const chatImpl = async (_cfg, msg) => { turns.push(msg); return '{"done":true,"verdicts":[]}'; };
  await runQaAgent({ surface: 'api', baseUrl: 'http://x', plan: '- R1', requirementIds: ['R1'], chatImpl, executor: async () => ({}), maxSteps: 4 });
  assert.ok(turns[0].system.includes('(no observations yet)'));
  assert.equal(turns[0].user, 'Decide the next step. You have 3 steps left; as soon as you cannot get more evidence, emit the final verdict covering every R#.');
});

test('httpExecutor: body null no viaja y una respuesta sin headers.get no rompe la observación', async () => {
  const inits = [];
  const fetchImpl = async (_url, init) => { inits.push(init); return { status: 200, headers: {}, text: async () => 'ok' }; };
  const obs = await httpExecutor('http://localhost:3000', { fetchImpl })({ type: 'http', path: '/a', body: null });
  assert.equal(inits[0].body, undefined);
  assert.equal(obs.ok, true);
  assert.equal(obs.status, 200);
  assert.equal('location' in obs, false);
});

// ── qaflow ───────────────────────────────────────────────────────────────────────────────────────
test('writeQaReplaySpecArtifact: sin resultado escribe el spec fixme', async (t) => {
  const proj = await tempDir(t);
  const { path } = await writeQaReplaySpecArtifact(proj, { id: '001-x', files: { 'spec.md': '' } }, 'http://a', undefined);
  assert.match(await readFile(path, 'utf8'), /test\.fixme\(/);
  assert.equal(existsSync(qaPlanPath(proj, '001-x')), false);
});

// ── qalogin ──────────────────────────────────────────────────────────────────────────────────────
test('secretQueryFields tolera un contrato ausente', () => {
  assert.deepEqual(secretQueryFields(undefined), []);
});

test('loopback: 127.x.y.z con octetos de varias cifras y la mapeada [::ffff:127.0.1.1] cuentan', () => {
  const base = { baseUrl: 'http://localhost:4200' };
  assert.equal(validateLoginEndpoint('http://127.0.0.10:3000/login', base).port, '3000');
  assert.equal(validateLoginEndpoint('http://[::ffff:127.0.1.1]:3000/login', base).port, '3000');
});

test('loopback: un dominio que empieza por 127.0.0.1 o una IPv6 que solo contiene la mapeada NO lo son', () => {
  const base = { baseUrl: 'http://localhost:4200' };
  for (const url of ['http://127.0.0.1.evil.com:3000/login', 'http://[1::ffff:7f00:1]:3000/login', 'http://[::ffff:7f00:1:2]:3000/login']) {
    assert.throws(() => validateLoginEndpoint(url, base), url);
  }
});

// ── childenv ─────────────────────────────────────────────────────────────────────────────────────
test('childEnvForApp: CHALC_PASS_ENV admite espacios alrededor de cada nombre', () => {
  const env = childEnvForApp({}, { CHALC_A: '1', CHALC_B: '2', CHALC_C: '3', CHALC_PASS_ENV: ' CHALC_A , CHALC_B ' });
  assert.equal(env.CHALC_A, '1');
  assert.equal(env.CHALC_B, '2');
  assert.equal(env.CHALC_C, undefined);
});
