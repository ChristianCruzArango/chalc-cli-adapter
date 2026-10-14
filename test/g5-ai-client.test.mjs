// T5 (spec 022) — el cliente de IA: reintentos con backoff (R18, F6), endurecimientos de la tabla S9
// (R17: nada de API key por http: fuera de loopback; cuerpo de error acotado y sin control) y config
// bajo CHALC_HOME (R18, F15). Sin red real ni tokens: servidor HTTP local y procesos hijos.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chat } from '../lib/ai.mjs';
import { t } from '../lib/i18n.mjs';

const OK = { choices: [{ message: { content: 'hola' } }] };

// Servidor que responde, en orden, cada elemento de `script`: { status, body } o 'drop' (corta el socket).
async function withServer(script, fn) {
  let hits = 0;
  const server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const step = script[Math.min(hits, script.length - 1)];
      hits += 1;
      if (step === 'drop') { req.socket.destroy(); return; }
      res.writeHead(step.status || 200, { 'content-type': 'application/json' });
      res.end(typeof step.body === 'string' ? step.body : JSON.stringify(step.body));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try { return await fn(`http://127.0.0.1:${server.address().port}/v1`, () => hits); } finally { server.close(); server.closeAllConnections?.(); }
}

const openai = (baseURL) => ({ provider: 'openai', apiKey: 'k', baseURL, model: 'm' });
const recorder = () => { const waits = []; return { waits, sleep: async (ms) => { waits.push(ms); } }; };

// T5 (spec 022, R18, F6)
test('T5 R18 F6: a 429 is retried with backoff and the call succeeds', async () => {
  const { waits, sleep } = recorder();
  await withServer([{ status: 429, body: 'slow down' }, { body: OK }], async (base, hits) => {
    assert.equal(await chat(openai(base), { system: 's', user: 'u', retry: { sleep } }), 'hola');
    assert.equal(hits(), 2);
  });
  assert.deepEqual(waits, [500]);
});

// T5 (spec 022, R18, F6)
test('T5 R18 F6: 5xx is retried twice (500 ms, 1500 ms) and then fails with the status', async () => {
  const { waits, sleep } = recorder();
  await withServer([{ status: 503, body: 'down' }], async (base, hits) => {
    await assert.rejects(chat(openai(base), { system: 's', user: 'u', retry: { sleep } }), /API 503: down/);
    assert.equal(hits(), 3);
  });
  assert.deepEqual(waits, [500, 1500]);
});

// T5 (spec 022, R18, F6)
test('T5 R18 F6: a 400 is not retried', async () => {
  const { waits, sleep } = recorder();
  await withServer([{ status: 400, body: 'bad model' }], async (base, hits) => {
    await assert.rejects(chat(openai(base), { system: 's', user: 'u', retry: { sleep } }), /API 400/);
    assert.equal(hits(), 1);
  });
  assert.deepEqual(waits, []);
});

// T5 (spec 022, R18, F6)
test('T5 R18 F6: a dropped connection (network error) is retried', async () => {
  const { sleep } = recorder();
  await withServer(['drop', { body: OK }], async (base, hits) => {
    assert.equal(await chat(openai(base), { system: 's', user: 'u', retry: { sleep } }), 'hola');
    assert.equal(hits(), 2);
  });
});

// T5 (spec 022, R18, F6)
test('T5 R18 F6: an abort during the backoff stops the retries', async () => {
  const controller = new AbortController();
  const sleep = async () => { controller.abort(); };
  await withServer([{ status: 503, body: 'down' }], async (base, hits) => {
    const err = await chat(openai(base), { system: 's', user: 'u', signal: controller.signal, retry: { sleep } }).catch((e) => e);
    assert.ok(err instanceof Error);
    assert.equal(hits(), 1);
  });
});

// T5 (spec 022, R17, S9 ai.mjs)
test('T5 R17 S9: the API key never travels over http: to a non-loopback host', async () => {
  const cfg = { provider: 'openai', apiKey: 'k', baseURL: 'http://api.example.com/v1', model: 'm' };
  await assert.rejects(chat(cfg, { system: 's', user: 'u' }), { message: t('aiInsecureBaseURL', 'http://api.example.com/v1') });
  const anth = { ...cfg, provider: 'anthropic' };
  await assert.rejects(chat(anth, { system: 's', user: 'u' }), { message: t('aiInsecureBaseURL', 'http://api.example.com/v1') });
});

// T5 (spec 022, R17, S9 ai.mjs)
test('T5 R17 S9: the API error body is capped at 500 chars and stripped of control sequences', async () => {
  const body = '\u001b[31mBOOM' + 'x'.repeat(3000);
  await withServer([{ status: 400, body }], async (base) => {
    const err = await chat(openai(base), { system: 's', user: 'u' }).catch((e) => e);
    assert.ok(!err.message.includes('\u001b'));
    assert.match(err.message, /^API 400: .*BOOM/);
    assert.ok(err.message.length <= 'API 400: '.length + 500, `length ${err.message.length}`);
  });
});

// T5 (spec 022, R18, F15)
test('T5 R18 F15: config.json lives under CHALC_HOME for the AI client and the saved language', async () => {
  const home = await mkdtemp(join(tmpdir(), 'chalc-f15-'));
  try {
    const chalcHome = join(home, 'custom');
    await mkdir(chalcHome, { recursive: true });
    await writeFile(join(chalcHome, 'config.json'), JSON.stringify({ lang: 'es' }));
    // import() exige una URL file://: una ruta de Windows (`D:\…`) se tomaría como el esquema `d:`.
    const ai = new URL('../lib/ai.mjs', import.meta.url).href;
    const i18n = new URL('../lib/i18n.mjs', import.meta.url).href;
    const script = `const a = await import(${JSON.stringify(ai)}); const i = await import(${JSON.stringify(i18n)}); console.log(JSON.stringify([a.CONFIG_PATH, i.lang]));`;
    const env = { ...process.env, CHALC_HOME: chalcHome, HOME: home, USERPROFILE: home, LANG: 'en_US.UTF-8', LC_ALL: '', LC_MESSAGES: '' };
    delete env.CHALC_LANG;
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { env, encoding: 'utf8' });
    assert.deepEqual(JSON.parse(out), [join(chalcHome, 'config.json'), 'es']);
  } finally { await rm(home, { recursive: true, force: true }); }
});
