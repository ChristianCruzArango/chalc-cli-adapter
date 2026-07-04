import test from 'node:test';
import assert from 'node:assert/strict';
import { isOllama, chatOllama, createChatImpl } from '../cli/engine/model.mjs';
import { resetTokens, tokenSummary } from '../lib/tokenmeter.mjs';

// fetch simulado: captura la URL y el body enviados, y devuelve una respuesta de Ollama nativa.
function fakeFetch(capture, response) {
  return async (url, opts) => {
    capture.url = url;
    capture.body = JSON.parse(opts.body);
    return { ok: true, json: async () => response };
  };
}

test('isOllama detecta por provider o por baseURL :11434', () => {
  assert.equal(isOllama({ provider: 'ollama' }), true);
  assert.equal(isOllama({ baseURL: 'http://localhost:11434/v1' }), true);
  assert.equal(isOllama({ provider: 'openai' }), false);
  assert.equal(isOllama({}), false);
});

test('chatOllama pega a /api/chat con num_ctx y format json, y devuelve el contenido', async () => {
  const cap = {};
  const fetchImpl = fakeFetch(cap, { message: { content: '{"done":true,"summary":"ok"}' }, prompt_eval_count: 12, eval_count: 8 });
  const out = await chatOllama({ provider: 'ollama', model: 'qwen2.5-coder:7b' }, { system: 's', user: 'u', numCtx: 8192, maxTokens: 500, fetchImpl });
  assert.equal(out, '{"done":true,"summary":"ok"}');
  assert.match(cap.url, /\/api\/chat$/);
  assert.equal(cap.body.format, 'json');
  assert.equal(cap.body.options.num_ctx, 8192);
  assert.equal(cap.body.options.num_predict, 500);
  assert.equal(cap.body.stream, false);
});

test('chatOllama normaliza el baseURL con /v1 a la ruta nativa', async () => {
  const cap = {};
  const fetchImpl = fakeFetch(cap, { message: { content: '{}' } });
  await chatOllama({ baseURL: 'http://localhost:11434/v1' }, { system: 's', user: 'u', fetchImpl });
  assert.equal(cap.url, 'http://localhost:11434/api/chat');
});

test('chatOllama registra el consumo en el medidor de tokens', async () => {
  resetTokens();
  const fetchImpl = fakeFetch({}, { message: { content: '{}' }, prompt_eval_count: 30, eval_count: 10 });
  await chatOllama({ provider: 'ollama', model: 'm' }, { system: 's', user: 'u', fetchImpl });
  const t = tokenSummary();
  assert.equal(t.input, 30);
  assert.equal(t.output, 10);
  resetTokens();
});

test('chatOllama lanza con detalle ante error HTTP', async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, headers: { get: () => null }, text: async () => 'boom' });
  await assert.rejects(() => chatOllama({ provider: 'ollama', model: 'm' }, { system: 's', user: 'u', fetchImpl }), /Ollama 500/);
});

// fetch simulado que enruta por URL: /api/show responde capabilities; /api/chat responde el turno.
function fakeFetchRouted(capture, { show, chat }) {
  return async (url, opts) => {
    if (/\/api\/show$/.test(url)) {
      capture.shows = (capture.shows || 0) + 1;
      return { ok: true, json: async () => show };
    }
    capture.url = url;
    capture.body = JSON.parse(opts.body);
    return { ok: true, json: async () => chat };
  };
}

test('modelo razonador (capability thinking): sin format json y con margen extra de num_predict', async () => {
  const cap = {};
  const fetchImpl = fakeFetchRouted(cap, {
    show: { capabilities: ['completion', 'tools', 'thinking'] },
    chat: { message: { content: '{"done":true,"summary":"ok"}', thinking: 'let me think…' } }
  });
  const out = await chatOllama({ provider: 'ollama', model: 'gpt-oss:20b' }, { system: 's', user: 'u', maxTokens: 500, fetchImpl });
  assert.equal(out, '{"done":true,"summary":"ok"}');
  assert.equal(cap.body.format, undefined);              // format json OMITIDO: rompe a los razonadores
  assert.equal(cap.body.options.num_predict, 500 + 2048); // el razonamiento consume salida antes del content
});

test('gpt-oss lleva think:low (nivel de razonamiento) y timeout amplio; otros razonadores no', async () => {
  const cap = {};
  const fetchImpl = fakeFetchRouted(cap, { show: { capabilities: ['thinking'] }, chat: { message: { content: '{}' } } });
  await chatOllama({ provider: 'ollama', model: 'gpt-oss:20b', cli: { think: 'high' } }, { system: 's', user: 'u', fetchImpl });
  assert.equal(cap.body.think, 'high');   // configurable vía cli.think (default low)
  await chatOllama({ provider: 'ollama', model: 'otro-razonador:8b' }, { system: 's', user: 'u', fetchImpl });
  assert.equal(cap.body.think, undefined);   // los niveles son de la familia gpt-oss
});

test('la sonda /api/show se cachea: una sola por modelo aunque haya varios turnos', async () => {
  const cap = {};
  const fetchImpl = fakeFetchRouted(cap, {
    show: { capabilities: ['thinking'] },
    chat: { message: { content: '{}' } }
  });
  const cfg = { provider: 'ollama', model: 'razonador-cacheado:1b' };
  await chatOllama(cfg, { system: 's', user: 'u', fetchImpl });
  await chatOllama(cfg, { system: 's', user: 'u', fetchImpl });
  assert.equal(cap.shows, 1);
});

test('razonador que emite tool_calls nativo: se traduce al JSON del protocolo', async () => {
  const fetchImpl = fakeFetchRouted({}, {
    show: { capabilities: ['thinking'] },
    chat: { message: { content: '', thinking: 'I should list the features folder first.', tool_calls: [{ id: 'call_1', function: { index: 0, name: 'list', arguments: { path: 'src/app' } } }] } }
  });
  const out = await chatOllama({ provider: 'ollama', model: 'razonador-toolcall:1b' }, { system: 's', user: 'u', fetchImpl });
  const turn = JSON.parse(out);
  assert.equal(turn.action.tool, 'list');
  assert.deepEqual(turn.action.args, { path: 'src/app' });
  assert.match(turn.thought, /features folder/);
});

test('tool_calls con arguments como string JSON también se traduce', async () => {
  const fetchImpl = fakeFetchRouted({}, {
    show: { capabilities: ['thinking'] },
    chat: { message: { content: '', tool_calls: [{ function: { name: 'read', arguments: '{"path":"README.md"}' } }] } }
  });
  const out = await chatOllama({ provider: 'ollama', model: 'razonador-strargs:1b' }, { system: 's', user: 'u', fetchImpl });
  assert.deepEqual(JSON.parse(out).action, { tool: 'read', args: { path: 'README.md' } });
});

test('si hay content, gana el content aunque vengan tool_calls', async () => {
  const fetchImpl = fakeFetchRouted({}, {
    show: { capabilities: ['thinking'] },
    chat: { message: { content: '{"done":true,"summary":"listo"}', tool_calls: [{ function: { name: 'read', arguments: {} } }] } }
  });
  const out = await chatOllama({ provider: 'ollama', model: 'razonador-content:1b' }, { system: 's', user: 'u', fetchImpl });
  assert.equal(out, '{"done":true,"summary":"listo"}');
});

test('razonador que deja content vacío: se devuelve su thinking como red de seguridad', async () => {
  const fetchImpl = fakeFetchRouted({}, {
    show: { capabilities: ['thinking'] },
    chat: { message: { content: '', thinking: 'Thus respond with {"done":true,"summary":"ok"}.' } }
  });
  const out = await chatOllama({ provider: 'ollama', model: 'razonador-vacio:1b' }, { system: 's', user: 'u', fetchImpl });
  assert.match(out, /"done":true/);   // el protocolo podrá extraer el JSON balanceado de ahí
});

test('modelo clásico conserva format json aunque /api/show falle', async () => {
  const cap = {};
  const fetchImpl = async (url, opts) => {
    if (/\/api\/show$/.test(url)) throw new Error('endpoint ausente');
    cap.body = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ message: { content: '{}' } }) };
  };
  await chatOllama({ provider: 'ollama', model: 'clasico-sin-show:1b' }, { system: 's', user: 'u', fetchImpl });
  assert.equal(cap.body.format, 'json');
});

test('createChatImpl devuelve una función con la firma del loop', () => {
  assert.equal(typeof createChatImpl({ provider: 'ollama', model: 'm' }), 'function');
  assert.equal(typeof createChatImpl({ provider: 'openai', model: 'gpt-4o' }), 'function');
});
