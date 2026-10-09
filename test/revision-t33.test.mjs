// T33 (spec 016, R33) — `runTask` cierra la sesión al terminar (también si falla), y un reintento tras un
// ERROR del modelo espera un backoff creciente que el aborto interrumpe (Ollama saturado no recibe tres
// peticiones seguidas).

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runTask } from '../cli/session.mjs';
import { runAgent } from '../cli/engine/loop.mjs';

async function projectWithMcp() {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-t33-'));
  await writeFile(join(dir, '.chalc.json'), JSON.stringify({ target: 'claude', skills: [], mcp: ['repo'] }));
  await writeFile(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { repo: { command: 'x' } } }));
  return dir;
}

function fakeMcp(stops) {
  return () => ({ start: async () => {}, listTools: async () => [], callTool: async () => ({}), stop: async () => { stops.push('stop'); } });
}

test('R33: runTask closes the session (MCP servers stopped) when it finishes', { timeout: 10000 }, async () => {
  const stops = [];
  const dir = await projectWithMcp();
  await runTask({ projectPath: dir, task: 'x', language: 'es', chatImpl: async () => '{"done":true,"summary":"ok"}', approveMcpServer: async () => true, mcpConnect: fakeMcp(stops) });
  assert.deepEqual(stops, ['stop']);
});

test('R33: runTask closes the session even when the turn throws', { timeout: 10000 }, async () => {
  const stops = [];
  const dir = await projectWithMcp();
  // El modelo pide una tool y el observador del paso lanza: el turno termina con error.
  await assert.rejects(() => runTask({
    projectPath: dir, task: 'x', language: 'es', approveMcpServer: async () => true, mcpConnect: fakeMcp(stops),
    chatImpl: async () => '{"action":{"tool":"list","args":{}}}',
    onStep: () => { throw new Error('observador roto'); }
  }), /observador roto/);
  assert.deepEqual(stops, ['stop']);
});

const renderPrompt = () => ({ system: 's', user: 'u' });

test('R33: retries after a model error wait a growing backoff', { timeout: 10000 }, async () => {
  let calls = 0;
  const started = Date.now();
  const r = await runAgent({ chatImpl: async () => { if (++calls < 3) throw new Error('busy'); return '{"done":true,"summary":"ok"}'; }, renderPrompt, maxRetries: 2, retryDelayMs: 60 });
  assert.equal(r.done, true);
  assert.ok(Date.now() - started >= 60 + 120 - 10, `${Date.now() - started} ms`);
});

test('R33: a malformed answer is retried at once (no backoff), and no backoff by default', { timeout: 10000 }, async () => {
  let calls = 0;
  const started = Date.now();
  await runAgent({ chatImpl: async () => (++calls < 2 ? 'no json' : '{"done":true,"summary":"ok"}'), renderPrompt, retryDelayMs: 2000 });
  await runAgent({ chatImpl: async () => { throw new Error('x'); }, renderPrompt, maxRetries: 2 });
  assert.ok(Date.now() - started < 1000);
});

test('R33: an abort during the backoff ends the turn at once', { timeout: 10000 }, async () => {
  const controller = new AbortController();
  const shouldStop = () => controller.signal.aborted;
  shouldStop.signal = controller.signal;
  const started = Date.now();
  const r = await runAgent({ chatImpl: async () => { setTimeout(() => controller.abort(), 20); throw new Error('busy'); }, renderPrompt, maxRetries: 3, retryDelayMs: 5000, shouldStop });
  assert.equal(r.interrupted, true);
  assert.ok(Date.now() - started < 1000);
});

test('R33: after the LAST failed attempt there is no wait before giving up', { timeout: 10000 }, async () => {
  const started = Date.now();
  const r = await runAgent({ chatImpl: async () => { throw new Error('down'); }, renderPrompt, maxRetries: 0, retryDelayMs: 5000 });
  assert.equal(r.done, false);
  assert.ok(Date.now() - started < 1000);
});

test('R33: the backoff keeps the process alive until the retry (no early exit without a TUI)', { timeout: 20000 }, () => {
  // Proceso aparte sin nada más vivo que la espera: con un temporizador `unref` salía antes de reintentar
  // (y en Node 20/22 el runner de tests cancelaba los casos de backoff).
  const script = `import { runAgent } from ${JSON.stringify(new URL('../cli/engine/loop.mjs', import.meta.url).href)};
let calls = 0;
const r = await runAgent({ chatImpl: async () => { if (++calls < 2) throw new Error('busy'); return '{"done":true,"summary":"ok"}'; }, renderPrompt: () => ({ system: 's', user: 'u' }), maxRetries: 2, retryDelayMs: 50 });
console.log(JSON.stringify({ done: r.done, calls }));`;
  const out = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 15000 });
  assert.equal(out.status, 0, out.stderr);
  assert.deepEqual(JSON.parse(out.stdout.trim()), { done: true, calls: 2 });
});
