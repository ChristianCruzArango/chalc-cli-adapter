// S-11 — los plazos cubren TODA la respuesta: un servidor que manda las cabeceras y retrasa el
// cuerpo ya no deja la lectura esperando sin límite.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fetchWithTimeout, readLimitedText } from '../lib/net.mjs';
import { createHttpClient } from '../cli/mcp/httpclient.mjs';

// Responde las cabeceras al instante y el cuerpo nunca (o tras `delayMs`).
async function slowBodyServer({ type = 'application/json', delayMs = 60000, body = '{}' } = {}) {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': type });
    res.flushHeaders();
    const timer = setTimeout(() => res.end(body), delayMs);
    res.on('close', () => clearTimeout(timer));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, url: `http://127.0.0.1:${server.address().port}/` };
}

test('fetchWithTimeout aborts a body that never arrives', async () => {
  const { server, url } = await slowBodyServer();
  try {
    const start = Date.now();
    const res = await fetchWithTimeout(url, { timeoutMs: 150 });
    await assert.rejects(() => readLimitedText(res));
    assert.ok(Date.now() - start < 3000);
  } finally { server.close(); server.closeAllConnections?.(); }
});

test('fetchWithTimeout keeps its own deadline when the caller passes a signal', async () => {
  const { server, url } = await slowBodyServer();
  try {
    const start = Date.now();
    const res = await fetchWithTimeout(url, { timeoutMs: 150, signal: new AbortController().signal });
    await assert.rejects(() => res.text());
    assert.ok(Date.now() - start < 3000);
  } finally { server.close(); server.closeAllConnections?.(); }
});

test('the MCP HTTP client times out while reading the body (30 ms, not ~257 ms or forever)', async () => {
  const { server, url } = await slowBodyServer();
  try {
    const client = createHttpClient({ url, timeoutMs: 30, allowPrivate: true });
    const start = Date.now();
    await assert.rejects(() => client.listTools(), /timeout/);
    assert.ok(Date.now() - start < 2000);
  } finally { server.close(); server.closeAllConnections?.(); }
});

test('the MCP HTTP client returns an SSE answer without waiting for the stream to close', async () => {
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      const { id } = JSON.parse(raw);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id, result: { tools: [{ name: 't' }] } })}\n\n`);
      // el stream se queda abierto a propósito
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const client = createHttpClient({ url: `http://127.0.0.1:${server.address().port}/`, timeoutMs: 2000, allowPrivate: true });
    assert.deepEqual(await client.listTools(), [{ name: 't' }]);
  } finally { server.close(); server.closeAllConnections?.(); }
});
