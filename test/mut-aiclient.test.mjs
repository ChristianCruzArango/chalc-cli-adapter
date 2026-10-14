// T10 (spec 022, R17, S9 / R18, F6 / R19, C5) — mutantes: reintentos del cliente de IA (espera
// abortable), URL insegura para la key, listado de modelos, key de un rol en otro proveedor, escapado
// de texto no confiable, runner git (plazo y git ausente) y HTML → texto. Sin red: fetch se sustituye.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { abortableSleep, isRetryable, withRetry } from '../lib/airetry.mjs';
import { isInsecureBaseURL } from '../lib/aiurl.mjs';
import { listModels } from '../lib/ai.mjs';
import { roleConfig } from '../lib/roleconfig.mjs';
import { escapeClosingTags } from '../lib/untrusted.mjs';
import { git } from '../lib/gitprep.mjs';
import { htmlToText, tidy } from '../lib/markup.mjs';
import { t } from '../lib/i18n.mjs';
import { tempDir } from './helpers/tmpdir.mjs';

// ---- reintentos (lib/airetry.mjs)

test('isRetryable: 408, 429 y 5xx sí; 4xx y ausencia de error no', () => {
  assert.equal(isRetryable(null), false);
  assert.equal(isRetryable(undefined), false);
  assert.equal(isRetryable({ status: 408 }), true);
  assert.equal(isRetryable({ status: 500 }), true);
  assert.equal(isRetryable({ status: 499 }), false);
});

// Señal falsa: registra quién se suscribe y quién se da de baja.
function fakeSignal(aborted = false) {
  return {
    aborted, reason: new Error('cancelado'), added: [], removed: [], onAbort: null,
    addEventListener(ev, fn, opts) { this.added.push([ev, opts]); this.onAbort = fn; },
    removeEventListener(ev) { this.removed.push(ev); }
  };
}

test('abortableSleep espera el plazo, escucha "abort" una sola vez y se da de baja al terminar', async (tc) => {
  tc.mock.timers.enable({ apis: ['setTimeout'] });
  const sig = fakeSignal();
  const p = abortableSleep(1000, sig);
  assert.deepEqual(sig.added, [['abort', { once: true }]]);
  tc.mock.timers.tick(1000);
  await p;
  assert.deepEqual(sig.removed, ['abort']);
});

test('abortableSleep rechaza con el motivo al abortar y cancela su temporizador', async (tc) => {
  tc.mock.timers.enable({ apis: ['setTimeout'] });
  const sig = fakeSignal();
  const p = abortableSleep(1000, sig);
  sig.onAbort();
  await assert.rejects(p, (e) => e === sig.reason);
  tc.mock.timers.tick(1000);
  assert.deepEqual(sig.removed, []);   // el temporizador ya no corre
});

test('abortableSleep con la señal ya abortada rechaza sin esperar ni suscribirse', async () => {
  const sig = fakeSignal(true);
  await assert.rejects(abortableSleep(60000, sig), (e) => e === sig.reason);
  assert.deepEqual(sig.added, []);
});

test('abortableSleep sin señal simplemente espera', async () => {
  assert.equal(await abortableSleep(1), undefined);
});

test('withRetry: si abortan durante la espera, sale con el motivo sin reintentar', async () => {
  const ctrl = new AbortController();
  const reason = new Error('Ctrl+C');
  let calls = 0;
  const call = async () => { calls++; throw Object.assign(new Error('503'), { status: 503 }); };
  await assert.rejects(withRetry(call, { signal: ctrl.signal, delays: [1, 1], sleep: async () => ctrl.abort(reason) }), (e) => e === reason);
  assert.equal(calls, 1);
});

// ---- URL insegura (lib/aiurl.mjs)

test('isInsecureBaseURL: solo el loopback exacto puede ir en http', () => {
  assert.equal(isInsecureBaseURL('http://localhost:11434'), false);
  assert.equal(isInsecureBaseURL('http://127.0.0.10/v1'), false);
  assert.equal(isInsecureBaseURL('http://localhost.evil.example/v1'), true);
  assert.equal(isInsecureBaseURL('http://notlocalhost/v1'), true);
  assert.equal(isInsecureBaseURL('no es una url'), false);
});

// ---- listado de modelos (lib/ai.mjs)

function mockFetch(tc) {
  return tc.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ data: [{ id: 'm1' }] }) }));
}

test('listModels no manda la key en claro a un host remoto ni consulta sin base URL', async (tc) => {
  const fetchMock = mockFetch(tc);
  assert.deepEqual(await listModels({ provider: 'openai', baseURL: 'http://remote.example/v1', apiKey: 'k' }), []);
  assert.deepEqual(await listModels({ provider: 'desconocido' }), []);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('listModels consulta en http sin key, o con key al loopback', async (tc) => {
  const fetchMock = mockFetch(tc);
  assert.deepEqual(await listModels({ provider: 'ollama', baseURL: 'http://remote.example' }), ['m1']);
  assert.deepEqual(await listModels({ provider: 'ollama', baseURL: 'http://localhost:11434', apiKey: 'k' }), ['m1']);
  assert.equal(fetchMock.mock.callCount(), 2);
});

// ---- rol en otro proveedor (lib/roleconfig.mjs)

test('roleConfig no falla con un proveedor desconocido (no se sabe si exige key)', () => {
  const cfg = { provider: 'openrouter', cli: { roles: { coder: { provider: 'inventado', model: 'x' } } } };
  assert.equal(roleConfig(cfg, 'coder').provider, 'inventado');
});

// ---- texto no confiable (lib/untrusted.mjs)

test('escapeClosingTags trata null/undefined como texto vacío', () => {
  assert.equal(escapeClosingTags(null), '');
  assert.equal(escapeClosingTags(undefined), '');
});

// ---- runner git (lib/gitprep.mjs)

test('git: cwd inexistente devuelve código -1, sin salida y el aviso de git no disponible', async (tc) => {
  const dir = await tempDir(tc);
  const res = await git(['status'], dir + '/no-existe');
  assert.deepEqual(res, { code: -1, out: '', err: t('gitUnavailable') });
});

test('git: al agotar el plazo mata el proceso y añade el aviso en su propia línea', { skip: process.platform === 'win32' }, async (tc) => {
  const dir = await tempDir(tc);
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['config', 'alias.lento', '!printf pre >&2; sleep 3'], { cwd: dir });
  const res = await git(['lento'], dir, { timeoutMs: 1000 });
  assert.equal(res.code, -1);
  assert.equal(res.err, 'pre\n' + t('gitTimedOut'));
});

// ---- HTML → texto (lib/markup.mjs)

test('tidy normaliza también el \\r suelto', () => {
  assert.equal(tidy('a\rb'), 'a\nb');
});

test('htmlToText: cierre de bloque con espacio y etiquetas que solo empiezan como <script', () => {
  assert.equal(htmlToText('a</ p>b'), 'a\nb');
  assert.equal(htmlToText('<scripted>Keep</scripted> tail </script>'), 'Keep tail');
});
