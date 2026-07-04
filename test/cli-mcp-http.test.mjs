// Tests de cli/mcp/httpclient.mjs contra un servidor MCP Streamable HTTP REAL (node:http local):
// handshake con Mcp-Session-Id, tools/list en JSON, tools/call respondido por SSE, y errores HTTP.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHttpClient } from '../cli/mcp/httpclient.mjs';

// Server MCP falso: initialize crea sesión, tools/list responde JSON, tools/call responde SSE.
function fakeMcpServer({ requireSession = true } = {}) {
  const seen = { sessions: [], calls: [] };
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (req.method === 'DELETE') { seen.deleted = req.headers['mcp-session-id']; res.writeHead(204).end(); return; }
      const msg = JSON.parse(body || '{}');
      seen.sessions.push(req.headers['mcp-session-id'] || null);
      if (msg.method === 'initialize') {
        res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'ses-42' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { capabilities: {} } }));
        return;
      }
      if (msg.method === 'notifications/initialized') { res.writeHead(202).end(); return; }
      if (requireSession && req.headers['mcp-session-id'] !== 'ses-42') { res.writeHead(400).end(); return; }
      if (msg.method === 'tools/list') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'ping', description: 'pong' }] } }));
        return;
      }
      if (msg.method === 'tools/call') {
        seen.calls.push(msg.params);
        // Respuesta por SSE (el otro formato válido del transporte), con un latido no-JSON intercalado.
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end(`: latido\n\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'hecho' }] } })}\n\n`);
        return;
      }
      res.writeHead(404).end();
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, seen, url: `http://127.0.0.1:${server.address().port}/mcp` })));
}

test('createHttpClient: handshake con sesión, tools/list (JSON) y tools/call (SSE)', async () => {
  const { server, seen, url } = await fakeMcpServer();
  const client = createHttpClient({ url, timeoutMs: 5000 });
  try {
    await client.start();
    const tools = await client.listTools();
    assert.equal(tools[0].name, 'ping');
    const r = await client.callTool('ping', { a: 1 });
    assert.equal(r.content[0].text, 'hecho');
    assert.deepEqual(seen.calls, [{ name: 'ping', arguments: { a: 1 } }]);
    // el session id de initialize viajó en los requests siguientes
    assert.equal(seen.sessions.filter((s) => s === 'ses-42').length >= 2, true);
    await client.stop();
    assert.equal(seen.deleted, 'ses-42');   // cierre de sesión best-effort
  } finally { server.close(); }
});

test('createHttpClient: headers extra (p. ej. Authorization) viajan en cada request', async () => {
  const authSeen = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      authSeen.push(req.headers.authorization);
      const msg = JSON.parse(body || '{}');
      if (msg.method === 'notifications/initialized') { res.writeHead(202).end(); return; }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { capabilities: {}, tools: [] } }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  try {
    const client = createHttpClient({ url, headers: { authorization: 'Bearer tok-123' }, timeoutMs: 5000 });
    await client.start();
    assert.ok(authSeen.every((a) => a === 'Bearer tok-123'));
  } finally { server.close(); }
});

test('createHttpClient: error HTTP y URL inalcanzable lanzan con detalle', async () => {
  const server = createServer((_req, res) => res.writeHead(500).end());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const bad = createHttpClient({ url: `http://127.0.0.1:${server.address().port}/`, timeoutMs: 3000 });
    await assert.rejects(() => bad.listTools(), /MCP HTTP 500/);
  } finally { server.close(); }
  const unreachable = createHttpClient({ url: 'http://127.0.0.1:1/', timeoutMs: 1500 });
  await assert.rejects(() => unreachable.listTools(), /no se pudo contactar/);
});

test('createHttpClient exige url', () => {
  assert.throws(() => createHttpClient({}), /falta "url"/);
});
