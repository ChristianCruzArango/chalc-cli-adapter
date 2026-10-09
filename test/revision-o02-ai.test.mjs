// O-02 (spec 016, R25) — el cliente de IA (lib/ai.mjs) lleva la `signal` del turno hasta la petición, y
// la ruta nativa de Anthropic arma la petición y lee la respuesta como antes. Sin red ni tokens: un
// servidor HTTP local captura cada petición y responde lo que el test le pide.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chat, PROVIDERS } from '../lib/ai.mjs';
import { t } from '../lib/i18n.mjs';
import { lastUsage, resetTokens } from '../lib/tokenmeter.mjs';
import { flushTokenLog, readTokenLog, resetTokenLog } from '../lib/tokenlog.mjs';

// Servidor que anota la última petición y responde con `reply` ({ status, body }).
async function withServer(reply, fn) {
  const seen = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : null });
      res.statusCode = reply.status || 200;
      res.setHeader('content-type', 'application/json');
      res.end(typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try { return await fn(`http://127.0.0.1:${server.address().port}/v1/`, seen); } finally { server.close(); }
}

const anthropic = (baseURL, extra = {}) => ({ provider: 'anthropic', apiKey: 'sk-test', baseURL, model: 'claude-x', task: 'spec', ...extra });

async function flushedEvents() {
  const root = await mkdtemp(join(tmpdir(), 'chalc-o02-ai-'));
  try { await flushTokenLog(root); return await readTokenLog(root); } finally { await rm(root, { recursive: true, force: true }); }
}

test('R25: Anthropic gets a POST to /messages with its headers, model, system and the user message', async () => {
  await withServer({ body: { content: [{ text: 'hola' }] } }, async (base, seen) => {
    assert.equal(await chat(anthropic(base), { system: 'sys', user: 'u1', maxTokens: 77 }), 'hola');
    const [req] = seen;
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/v1/messages');
    assert.equal(req.headers['content-type'], 'application/json');
    assert.equal(req.headers['x-api-key'], 'sk-test');
    assert.equal(req.headers['anthropic-version'], '2023-06-01');
    assert.deepEqual(req.body, { model: 'claude-x', max_tokens: 77, system: 'sys', messages: [{ role: 'user', content: 'u1' }] });
  });
});

test('R25: without a model Anthropic uses the provider default', async () => {
  await withServer({ body: { content: [] } }, async (base, seen) => {
    assert.equal(await chat(anthropic(base, { model: '' }), { system: 's', user: 'u' }), '');
    assert.equal(seen[0].body.model, PROVIDERS.anthropic.defaultModel);
  });
});

test('R25: JSON mode prefills "{" and puts it back when the answer continues it', async () => {
  await withServer({ body: { content: [{ text: '"a":1}' }] } }, async (base, seen) => {
    assert.equal(await chat(anthropic(base), { system: 's', user: 'u', json: true }), '{"a":1}');
    assert.deepEqual(seen[0].body.messages, [{ role: 'user', content: 'u' }, { role: 'assistant', content: '{' }]);
  });
  await withServer({ body: { content: [{ text: '  {"a":1}' }] } }, async (base) => {
    assert.equal(await chat(anthropic(base), { system: 's', user: 'u', json: true }), '  {"a":1}');
  });
});

test('R25: plain mode sends no prefill and returns the text as is, joining every block', async () => {
  await withServer({ body: { content: [{ text: 'uno ' }, { type: 'tool_use' }, { text: 'dos}' }] } }, async (base, seen) => {
    assert.equal(await chat(anthropic(base), { system: 's', user: 'u' }), 'uno dos}');
    assert.equal(seen[0].body.messages.length, 1);
  });
});

test('R25: an Anthropic error carries the status and the body', async () => {
  await withServer({ status: 529, body: 'overloaded' }, async (base) => {
    await assert.rejects(chat(anthropic(base), { system: 's', user: 'u' }), /^Error: Anthropic 529: overloaded/);
  });
});

test('R25: Anthropic usage is metered and logged with provider, model and task', async () => {
  resetTokens(); resetTokenLog();
  try {
    await withServer({ body: { content: [{ text: 'ok' }], usage: { input_tokens: 9, output_tokens: 3 } } }, async (base) => {
      await chat(anthropic(base), { system: 's', user: 'u' });
    });
    assert.deepEqual([lastUsage().input, lastUsage().output], [9, 3]);
    const [ev, ...rest] = await flushedEvents();
    assert.deepEqual(rest, []);
    assert.deepEqual([ev.provider, ev.model, ev.task, ev.input, ev.output], ['anthropic', 'claude-x', 'spec', 9, 3]);
  } finally { resetTokens(); resetTokenLog(); }
});

test('R25: an aborted turn signal cancels the request on both routes', async () => {
  const signal = AbortSignal.abort();
  await withServer({ body: { content: [] } }, async (base) => {
    await assert.rejects(chat(anthropic(base), { system: 's', user: 'u', signal }));
    await assert.rejects(chat({ provider: 'openai', apiKey: 'k', baseURL: base, model: 'm' }, { system: 's', user: 'u', signal }));
  });
});

test('R25: an unknown provider fails with the translated message, before any request', async () => {
  await assert.rejects(chat({ provider: 'nope' }, { system: 's', user: 'u' }), { message: t('aiUnknownProvider', 'nope') });
});

test('R25: OpenAI-compatible asks for a JSON object only in JSON mode', async () => {
  await withServer({ body: { choices: [{ message: { content: '{}' } }] } }, async (base, seen) => {
    const cfg = { provider: 'openai', apiKey: 'k', baseURL: base, model: 'm' };
    await chat(cfg, { system: 's', user: 'u' });
    await chat(cfg, { system: 's', user: 'u', json: true });
    assert.equal(seen[0].url, '/v1/chat/completions');
    assert.equal('response_format' in seen[0].body, false);
    assert.deepEqual(seen[1].body.response_format, { type: 'json_object' });
  });
});
