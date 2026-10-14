// T2 (spec 022, R17, S9 MCP) — la respuesta JSON del transporte HTTP se correlaciona con la petición
// (`id` y `jsonrpc: '2.0'`), y una línea stdio sin fin se mide en BYTES, no en caracteres.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHttpClient } from '../cli/mcp/httpclient.mjs';
import { lineOverflow } from '../cli/mcp/client.mjs';

const jsonFetch = (reply) => async () => new Response(JSON.stringify(reply(1)), { status: 200, headers: { 'content-type': 'application/json' } });
const client = (reply) => createHttpClient({ url: 'https://mcp.example.test/', fetchImpl: jsonFetch(reply), validateUrl: async () => {} });

// T2 (spec 022, R17, S9 MCP id)
test('T2 (spec 022, R17, S9 MCP id): a JSON reply for another id is rejected', async () => {
  await assert.rejects(() => client((id) => ({ jsonrpc: '2.0', id: id + 99, result: {} })).start(), /MCP HTTP/);
});

test('T2 (spec 022, R17, S9 MCP id): a JSON reply without jsonrpc 2.0 is rejected', async () => {
  await assert.rejects(() => client((id) => ({ id, result: {} })).start(), /MCP HTTP/);
});

test('T2 (spec 022, R17, S9 MCP id): a correlated JSON reply is accepted', async () => {
  let n = 0;
  const c = createHttpClient({
    url: 'https://mcp.example.test/',
    validateUrl: async () => {},
    fetchImpl: async (_u, init) => {
      const msg = JSON.parse(init.body);
      n++;
      if (msg.id === undefined) return new Response(null, { status: 202 });
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'x' }] } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  await c.start();
  assert.deepEqual(await c.listTools(), [{ name: 'x' }]);
  assert.ok(n >= 3);
});

// T2 (spec 022, R17, S9 MCP bytes)
test('T2 (spec 022, R17, S9 MCP bytes): the unterminated-line cap counts UTF-8 bytes, not characters', () => {
  const multibyte = 'ñ'.repeat(6);          // 6 caracteres, 12 bytes
  assert.equal(lineOverflow(multibyte, 10), true);
  assert.equal(lineOverflow('a'.repeat(10), 10), false);
  assert.equal(lineOverflow('a'.repeat(11), 10), true);
  assert.equal(lineOverflow('ñ'.repeat(20) + '\n', 10), false, 'con salto de línea no es una línea sin fin');
});
