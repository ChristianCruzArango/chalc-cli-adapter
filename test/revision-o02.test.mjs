// O-02 (spec 016, R25) — Ctrl+C/ESC aborta EN CURSO (en menos de 1 s) la llamada al modelo, la shell y
// la tool MCP, mediante un AbortSignal por turno. Antes la interrupción solo se miraba entre pasos: con
// Ollama colgado podían ser 300 s × 3 intentos con la UI en «interrumpiendo…».

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAgent } from '../cli/engine/loop.mjs';
import { chatOllama, createChatImpl } from '../cli/engine/model.mjs';
import { execBounded, createShellTool, liveChildren } from '../cli/tools/shell.mjs';
import { mcpToolsForAgent } from '../cli/mcp/astools.mjs';
import { interruptible } from '../cli/shell/turns.mjs';

const POSIX = process.platform !== 'win32';
const renderPrompt = () => ({ system: 's', user: 'u' });

// Un "stop" como el que crea la shell: función + su señal.
function stopper() {
  const controller = new AbortController();
  const shouldStop = () => controller.signal.aborted;
  shouldStop.signal = controller.signal;
  return { shouldStop, abort: () => controller.abort() };
}

// Un modelo colgado: solo termina si le abortan la señal.
const hangingModel = (calls) => ({ signal }) => {
  calls.push(signal);
  return new Promise((_, reject) => signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
};

test('R25: aborting while the model call is in flight ends the turn fast, with no retries', { timeout: 5000 }, async () => {
  const calls = [];
  const { shouldStop, abort } = stopper();
  setTimeout(abort, 50);
  const started = Date.now();
  const r = await runAgent({ chatImpl: hangingModel(calls), renderPrompt, shouldStop, maxRetries: 2 });
  assert.equal(r.interrupted, true);
  assert.equal(calls.length, 1);
  assert.ok(calls[0] instanceof AbortSignal);
  assert.ok(Date.now() - started < 1000);
});

test('R25: a model error after the abort does not trigger retries', { timeout: 5000 }, async () => {
  let calls = 0;
  const { shouldStop, abort } = stopper();
  const chatImpl = async () => { calls++; abort(); throw new Error('ECONNRESET'); };
  const r = await runAgent({ chatImpl, renderPrompt, shouldStop, maxRetries: 3 });
  assert.equal(r.interrupted, true);
  assert.equal(calls, 1);
});

test('R25: without a signal the loop behaves as before (retries on model errors)', { timeout: 5000 }, async () => {
  let calls = 0;
  const r = await runAgent({ chatImpl: async () => { calls++; throw new Error('down'); }, renderPrompt, maxRetries: 2 });
  assert.equal(calls, 3);
  assert.equal(r.done, false);
  assert.equal(r.interrupted, undefined);
});

test('R25: tools receive the turn signal', { timeout: 5000 }, async () => {
  const { shouldStop } = stopper();
  const seen = [];
  const tools = { t: { summary: 't', run: async (args, ctx) => { seen.push(ctx?.signal); return { ok: true }; } } };
  let i = 0;
  const chatImpl = async () => ['{"action":{"tool":"t","args":{}}}', '{"done":true,"summary":"ok"}'][i++];
  await runAgent({ chatImpl, tools, renderPrompt, shouldStop });
  assert.equal(seen[0], shouldStop.signal);
});

test('R25: aborting the turn aborts the real request, for Ollama and cloud adapters', { timeout: 5000 }, async () => {
  const original = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, opts) => {
    seen.push({ url, signal: opts.signal });
    const payload = url.endsWith('/api/show') ? {} : url.endsWith('/api/chat') ? { message: { content: '{}' } } : { choices: [{ message: { content: '{}' } }] };
    return new Response(JSON.stringify(payload), { status: 200 });
  };
  try {
    for (const cfg of [{ provider: 'ollama', model: 'senal-o02:1b' }, { provider: 'openrouter', model: 'x', apiKey: 'k' }, { provider: 'anthropic', model: 'x', apiKey: 'k' }]) {
      seen.length = 0;
      const { shouldStop, abort } = stopper();
      await createChatImpl(cfg)({ system: 's', user: 'u', signal: shouldStop.signal });
      const call = seen.find(({ url }) => !url.endsWith('/api/show'));
      assert.equal(call.signal.aborted, false, cfg.provider);
      abort();
      assert.equal(call.signal.aborted, true, cfg.provider);
    }
  } finally { globalThis.fetch = original; }
});

test('R25: chatOllama with an injected fetch receives the turn signal itself', { timeout: 5000 }, async () => {
  const { shouldStop } = stopper();
  const seen = [];
  const fetchImpl = async (url, opts) => { seen.push([url.split('/').pop(), opts.signal]); return { ok: true, json: async () => (url.endsWith('/api/show') ? {} : { message: { content: '{}' } }) }; };
  await chatOllama({ provider: 'ollama', model: 'senal-o02b:1b' }, { system: 's', user: 'u', fetchImpl, signal: shouldStop.signal });
  assert.equal(seen.find(([u]) => u === 'chat')[1], shouldStop.signal);
});

test('R25: a malformed answer after the abort is not retried, and no retry notice is shown', { timeout: 5000 }, async () => {
  let calls = 0;
  const notices = [];
  const { shouldStop, abort } = stopper();
  const r1 = await runAgent({ chatImpl: async () => { calls++; abort(); return 'no es json'; }, renderPrompt, shouldStop, maxRetries: 3 });
  assert.equal(r1.interrupted, true);
  assert.equal(calls, 1);
  const s2 = stopper();
  await runAgent({ chatImpl: async () => { s2.abort(); throw new Error('ECONNRESET'); }, renderPrompt, shouldStop: s2.shouldStop, maxRetries: 3, onStep: (e) => notices.push(e) });
  assert.deepEqual(notices, []);
});

test('R25: an aborted shell command is killed and resolves in well under a second', { timeout: 5000, skip: !POSIX }, async () => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 100);
  const started = Date.now();
  const r = await execBounded('sleep 30', { cwd: process.cwd(), signal: controller.signal });
  assert.ok(Date.now() - started < 1000);
  assert.match(r.stderr, /interrupted/);
  await new Promise((res) => setTimeout(res, 200));
  assert.equal(liveChildren(), 0);
});

test('R25: an already aborted signal does not even start the command', { timeout: 5000, skip: !POSIX }, async () => {
  const controller = new AbortController();
  controller.abort();
  const root = await mkdtemp(join(tmpdir(), 'chalc-o02-'));
  const { bash } = createShellTool({ root, allow: ['sleep'], approve: async () => true });
  const r = await bash.run({ command: 'sleep 30' }, { signal: controller.signal });
  assert.match(r.stderr, /interrupted/);
  assert.equal(r.code, -1);
});

test('R25: an MCP call stops waiting when the turn is aborted', { timeout: 5000 }, async () => {
  const controller = new AbortController();
  const client = { callTool: () => new Promise(() => {}) };   // servidor que no contesta
  const tools = mcpToolsForAgent([{ id: 'srv', client, tools: [{ name: 'lento', inputSchema: {} }] }], { approve: async () => true });
  setTimeout(() => controller.abort(), 50);
  const started = Date.now();
  const out = await tools['mcp__srv__lento'].run({}, { signal: controller.signal });
  assert.ok(Date.now() - started < 1000);
  assert.match(out.error, /interrupted/);
});

test('R25: interruptible exposes the turn signal and aborts it on interrupt', { timeout: 5000 }, () => {
  let turn = null;
  const io = { setTurn: (t) => { turn = t; }, print: () => {} };
  const shouldStop = interruptible(io, 'parando');
  assert.equal(shouldStop.signal.aborted, false);
  turn.interrupt();
  assert.equal(shouldStop(), true);
  assert.equal(shouldStop.signal.aborted, true);
});

test('R25: an MCP call with an already aborted signal returns at once', { timeout: 5000 }, async () => {
  const controller = new AbortController();
  controller.abort();
  const client = { callTool: () => new Promise(() => {}) };
  const tools = mcpToolsForAgent([{ id: 'srv', client, tools: [{ name: 'lento', inputSchema: {} }] }], { approve: async () => true });
  assert.match((await tools['mcp__srv__lento'].run({}, { signal: controller.signal })).error, /interrupted/);
});
