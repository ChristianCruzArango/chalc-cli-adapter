// test/tokenlog-wiring.test.mjs — R1 de specs/002-chalc-tokens: los DOS embudos reales de IA
// (lib/ai.mjs chat() para bin y nube de la shell; cli/engine/model.mjs chatOllama para Ollama nativo)
// registran cada llamada en el tokenlog con proveedor/modelo/tarea. Sin red: server HTTP local y
// fetchImpl inyectado.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chat, configForTask } from '../lib/ai.mjs';
import { chatOllama } from '../cli/engine/model.mjs';
import { flushTokenLog, readTokenLog, resetTokenLog } from '../lib/tokenlog.mjs';

const makeRoot = () => mkdtemp(join(tmpdir(), 'chalc-wiring-'));

// Vuelca el buffer a disco y lo lee: la única ventana pública al registro (no se exponen internals).
async function flushedEvents() {
  const root = await makeRoot();
  try {
    await flushTokenLog(root);
    return await readTokenLog(root);
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('R1: configForTask etiqueta la config con la tarea (el embudo no adivina el rol)', () => {
  const cfg = { provider: 'openai', model: 'default-model', models: { spec: 'spec-model' } };
  assert.equal(configForTask(cfg, 'spec').task, 'spec');
  assert.equal(configForTask(cfg, 'qa').task, 'qa');
  assert.equal(configForTask(cfg).task, 'default');
});

test('R1: chat() (OpenAI-compatible) registra la llamada en el tokenlog con provider/model/task', async () => {
  resetTokenLog();
  // server local que imita /chat/completions con usage al estilo OpenAI
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 11, completion_tokens: 4 } }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/v1`;
  try {
    const cfg = configForTask({ provider: 'openai', apiKey: 'k', baseURL: base, model: 'gpt-4o' }, 'qa');
    const out = await chat(cfg, { system: 's', user: 'u' });
    assert.equal(out, 'ok');
    const events = await flushedEvents();
    assert.equal(events.length, 1);
    assert.equal(events[0].provider, 'openai');
    assert.equal(events[0].model, 'gpt-4o');
    assert.equal(events[0].task, 'qa');
    assert.equal(events[0].input, 11);
    assert.equal(events[0].output, 4);
  } finally { server.close(); resetTokenLog(); }
});

test('R1: chatOllama (ruta nativa) registra la llamada con provider ollama y los contadores nativos', async () => {
  resetTokenLog();
  // fetch falso: /api/show (sonda de capabilities) y /api/chat con contadores nativos de Ollama
  const fetchImpl = async (url) => ({
    ok: true,
    json: async () => (String(url).endsWith('/api/show')
      ? { capabilities: [] }
      : { message: { content: '{"done":true}' }, prompt_eval_count: 9, eval_count: 3 })
  });
  try {
    const out = await chatOllama({ provider: 'ollama', model: 'llama3.1', task: 'coder' }, { system: 's', user: 'u', fetchImpl });
    assert.equal(out, '{"done":true}');
    const events = await flushedEvents();
    assert.equal(events.length, 1);
    assert.equal(events[0].provider, 'ollama');
    assert.equal(events[0].model, 'llama3.1');
    assert.equal(events[0].task, 'coder');
    assert.equal(events[0].input, 9);
    assert.equal(events[0].output, 3);
  } finally { resetTokenLog(); }
});
