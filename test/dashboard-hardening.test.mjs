// S-12 — el dashboard no ejecuta HTML de un asunto de commit, no responde a DNS rebinding y la
// vista de consola no deja pasar secuencias de escape.

import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderPage, renderTerminal, startDashboard } from '../lib/dashboard.mjs';
import { stripControl } from '../lib/termsafe.mjs';
import { c } from '../lib/ansi.mjs';

const HOSTILE = 'x" onmouseover="alert(1)\' y';

test('the page escapes quotes, so a commit subject cannot open an attribute', () => {
  const page = renderPage({ baseDir: '/tmp', workspaces: [] });
  const line = page.split('\n').find((l) => l.startsWith('const esc ='));
  const esc = new Function(`${line}; return esc;`)();
  assert.equal(esc(HOSTILE), 'x&quot; onmouseover=&quot;alert(1)&#39; y');
});

function get(port, host) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: '/api/state', headers: { host } }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
    req.end();
  });
}

test('the server only answers requests addressed to localhost', async () => {
  const base = await mkdtemp(join(tmpdir(), 'chalc-dash-host-'));
  const { server, port } = await startDashboard({ baseDir: base, port: 0 });
  try {
    assert.equal(await get(port, 'evil.example:' + port), 403);
    assert.equal(await get(port, 'localhost.evil.example'), 403);
    assert.equal(await get(port, `localhost:${port}`), 200);
    assert.equal(await get(port, `127.0.0.1:${port}`), 200);
  } finally {
    server.close();
  }
});

test('the console view strips escape sequences from commit subjects and tasks', () => {
  const side = { name: 'back', branch: 'feat\x1b]52;c;cHduZWQ=\x07', tasks: { done: 1, total: 2 }, clean: true, commits: 1,
    lastCommit: 'fix\x1b[2K\x1b[1Gall good', current: 'task\x1b[8mhidden' };
  const out = renderTerminal({ workspaces: [{ id: 'w1', status: 'in-progress', sides: [side, { ...side, name: 'front', branch: 'other' }] }], log: ['l\x1b[2J'] });
  for (const seq of ['\x1b[2K', '\x1b]52', '\x1b[8m', '\x1b[2J', '\x07']) assert.equal(out.includes(seq), false, JSON.stringify(seq));
  // El estilo propio de la vista sí se conserva cuando hay color (TTY y sin NO_COLOR); sin él, la
  // paleta común (lib/ansi.mjs) escribe texto plano y no debe quedar ninguna secuencia.
  if (c.bold('x') !== 'x') assert.match(out, /\x1b\[1m/);
  else assert.equal(out.includes('\x1b'), false);
});

test('stripControl keeps newlines and tabs', () => {
  assert.equal(stripControl('a\tb\nc\x1b[31m\x9bd'), 'a\tb\nc[31md');
});
