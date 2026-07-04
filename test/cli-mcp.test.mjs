import test from 'node:test';
import assert from 'node:assert/strict';
import { createJsonRpc } from '../cli/mcp/jsonrpc.mjs';
import { connectMcpServers, mcpToolsForAgent, stopMcpConnections, unwrapMcpResult } from '../cli/mcp/astools.mjs';

test('createJsonRpc correlaciona respuesta con request por id', async () => {
  const sent = [];
  const rpc = createJsonRpc({ send: (m) => sent.push(m) });
  const p = rpc.request('tools/list', {});
  assert.equal(sent[0].method, 'tools/list');
  assert.equal(sent[0].jsonrpc, '2.0');
  rpc.handle({ jsonrpc: '2.0', id: sent[0].id, result: { tools: [{ name: 'q' }] } });
  assert.deepEqual((await p).tools, [{ name: 'q' }]);
});

test('createJsonRpc rechaza ante error JSON-RPC y hace timeout', async () => {
  const rpc = createJsonRpc({ send: () => {}, timeoutMs: 20 });
  const err = rpc.request('x', {});
  const id = 1;
  rpc.handle({ jsonrpc: '2.0', id, error: { code: -32601, message: 'método no existe' } });
  await assert.rejects(() => err, /método no existe/);
  await assert.rejects(() => rpc.request('y', {}), /timeout/);   // nunca llega respuesta
});

test('createJsonRpc tras close: lo pendiente rechaza Y un request posterior rechaza AL INSTANTE', async () => {
  const rpc = createJsonRpc({ send: () => {}, timeoutMs: 5000 });
  const pendiente = rpc.request('x', {});
  rpc.close(new Error('el servidor MCP terminó (código 1)'));
  await assert.rejects(() => pendiente, /terminó/);
  // request posterior sobre la conexión muerta: rechazo inmediato (sin escribirle al vacío ni esperar timeout)
  await assert.rejects(() => rpc.request('y', {}), /terminó/);
});

test('createJsonRpc rechaza al instante si el transporte lanza al enviar (stream destruido)', async () => {
  const rpc = createJsonRpc({ send: () => { throw new Error('write after destroy'); }, timeoutMs: 5000 });
  await assert.rejects(() => rpc.request('x', {}), /write after destroy/);
});

test('createJsonRpc.notify no espera respuesta; handle ignora ids desconocidos', () => {
  const sent = [];
  const rpc = createJsonRpc({ send: (m) => sent.push(m) });
  rpc.notify('notifications/initialized', {});
  assert.equal(sent[0].id, undefined);
  assert.doesNotThrow(() => rpc.handle({ jsonrpc: '2.0', id: 999, result: {} }));
});

// Cliente MCP falso: no spawnea procesos, devuelve tools y registra las llamadas.
function fakeClient(tools, calls = []) {
  return { start: async () => {}, listTools: async () => tools, callTool: async (name, args) => { calls.push({ name, args }); return { content: [{ type: 'text', text: 'ok' }] }; }, stop: async () => { calls.push({ stopped: true }); } };
}

test('connectMcpServers conecta cada servidor del proyecto y omite los que fallan', async () => {
  const servers = { postgres: { command: 'x' }, roto: { command: 'y' } };
  const warned = [];
  const conns = await connectMcpServers(servers, {
    connect: (cfg, id) => (id === 'roto' ? (() => { throw new Error('no arranca'); })() : fakeClient([{ name: 'query', description: 'SQL', inputSchema: { type: 'object' } }])),
    onWarn: (id, msg) => warned.push([id, msg])
  });
  assert.equal(conns.length, 1);
  assert.equal(conns[0].id, 'postgres');
  assert.deepEqual(warned, [['roto', 'no arranca']]);
});

test('connectMcpServers detiene el cliente si el handshake falla (sin fugas de procesos)', async () => {
  const events = [];
  const conns = await connectMcpServers({ s: { command: 'x' } }, {
    connect: () => ({ start: async () => { throw new Error('timeout initialize'); }, stop: async () => events.push('stop') }),
    onWarn: (_id, msg) => events.push(`warn:${msg}`)
  });
  assert.equal(conns.length, 0);
  assert.deepEqual(events, ['stop', 'warn:timeout initialize']);   // stop ANTES de avisar
});

test('connectMcpServers respeta approveServer: un servidor no aprobado NO se ejecuta', async () => {
  let spawned = 0;
  const warned = [];
  const conns = await connectMcpServers({ ok: { command: 'a' }, malicioso: { command: 'b' } }, {
    connect: () => { spawned++; return fakeClient([]); },
    approveServer: async (id) => id === 'ok',
    onWarn: (id, msg) => warned.push([id, msg])
  });
  assert.equal(conns.length, 1);
  assert.equal(conns[0].id, 'ok');
  assert.equal(spawned, 1);   // el rechazado ni siquiera se spawnea
  assert.deepEqual(warned[0][0], 'malicioso');
  assert.match(warned[0][1], /no aprobó/);
});

test('mcpToolsForAgent expone tools con nombre mcp__server__tool, aprobación y describe diferido', async () => {
  const calls = [];
  const conns = [{ id: 'postgres', client: fakeClient([], calls), tools: [{ name: 'query', description: 'Ejecuta SQL', inputSchema: { type: 'object', properties: { sql: { type: 'string' } } } }] }];

  // Sin aprobación: no llama al servidor.
  const denied = mcpToolsForAgent(conns, { approve: async () => false, language: 'es' });
  assert.ok('mcp__postgres__query' in denied);
  assert.match(denied['mcp__postgres__query'].summary, /\[MCP postgres\] Ejecuta SQL/);   // índice compacto
  assert.match((await denied['mcp__postgres__query'].run({ sql: 'x' })).error, /not approved/);
  assert.equal(calls.length, 0);

  // Con aprobación: llama al servidor con el nombre real (sin el prefijo).
  const ok = mcpToolsForAgent(conns, { approve: async () => true, language: 'es' });
  await ok['mcp__postgres__query'].run({ sql: 'SELECT 1' });
  assert.deepEqual(calls, [{ name: 'query', args: { sql: 'SELECT 1' } }]);

  // describe: el esquema completo NO está en el índice; se pide bajo demanda.
  const d = await ok.describe.run({ tool: 'mcp__postgres__query' });
  assert.equal(d.schema.properties.sql.type, 'string');
  assert.match((await ok.describe.run({ tool: 'nope' })).error, /no schema/);
  // nombre incompleto (solo el server): lista las tools reales de ese prefijo en vez de un error seco
  const partial = await ok.describe.run({ tool: 'mcp__postgres' });
  assert.match(partial.error, /incomplete name/);
  assert.deepEqual(partial.tools, ['mcp__postgres__query']);
});

test('mcpToolsForAgent sin conexiones no crea describe', () => {
  assert.deepEqual(mcpToolsForAgent([]), {});
});

test('unwrapMcpResult aplana el envoltorio MCP a texto/error para el modelo', () => {
  assert.deepEqual(unwrapMcpResult({ content: [{ type: 'text', text: 'Found 0 workspace(s).' }] }), { text: 'Found 0 workspace(s).' });
  assert.deepEqual(unwrapMcpResult({ content: [{ type: 'text', text: 'boom' }], isError: true }), { error: 'boom' });
  assert.deepEqual(unwrapMcpResult({ content: [] }), { ok: true });
  assert.match(unwrapMcpResult({ content: [{ type: 'image', data: 'x' }] }).text, /no textual/);
});

test('el índice de tools MCP anuncia los args (con * los obligatorios) y expone argHints', async () => {
  const conns = [{ id: 'ng', client: fakeClient([]), tools: [{
    name: 'search_documentation', description: 'Busca en la doc',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, version: { type: 'number' } }, required: ['query'] }
  }] }];
  const tools = mcpToolsForAgent(conns, { language: 'es' });
  const t = tools['mcp__ng__search_documentation'];
  assert.match(t.summary, /args: query\*, version/);   // el modelo ve QUÉ mandar sin llamar mal primero
  assert.deepEqual(t.argHints, ['query', 'version']);
});

test('un error de argumentos MCP llega COMPACTO y con la pista de usar describe', async () => {
  // Reproduce el caso real: el server valida con zod y devuelve un volcado JSON multilínea gigante.
  const zodDump = 'MCP error -32602: Input validation error: Invalid arguments for tool search_documentation: [\n  {\n    "expected": "string",\n    "code": "invalid_type",\n    "path": [\n      "query"\n    ],\n    "message": "Invalid input: expected string, received undefined"\n  }\n]';
  const client = { callTool: async () => { throw new Error(zodDump); } };
  const tools = mcpToolsForAgent([{ id: 'ng', client, tools: [{ name: 'search_documentation', description: 'd' }] }], { approve: async () => true, language: 'es' });
  const obs = await tools['mcp__ng__search_documentation'].run({});
  assert.ok(obs.error.length <= 280, 'el error queda compactado');
  assert.doesNotMatch(obs.error, /\n/);   // una sola línea
  assert.match(obs.hint, /describe/);      // pista accionable para que el modelo consulte el esquema
  assert.match(obs.hint, /mcp__ng__search_documentation/);

  // un error MCP que NO es de argumentos no lleva hint
  const other = { callTool: async () => ({ content: [{ type: 'text', text: 'permiso denegado' }], isError: true }) };
  const t2 = mcpToolsForAgent([{ id: 'x', client: other, tools: [{ name: 'op', description: 'd' }] }], { approve: async () => true, language: 'es' });
  const obs2 = await t2['mcp__x__op'].run({});
  assert.equal(obs2.hint, undefined);
});

test('las tools MCP del agente devuelven la observación DESENVUELTA (texto plano)', async () => {
  const client = { callTool: async () => ({ content: [{ type: 'text', text: 'proyecto creado' }] }) };
  const tools = mcpToolsForAgent([{ id: 's', client, tools: [{ name: 'gen', description: 'g' }] }], { approve: async () => true });
  assert.deepEqual(await tools['mcp__s__gen'].run({}), { text: 'proyecto creado' });
});

test('stopMcpConnections detiene todos los clientes (best-effort)', async () => {
  const calls = [];
  await stopMcpConnections([{ client: fakeClient([], calls) }, { client: { /* sin stop */ } }]);
  assert.deepEqual(calls, [{ stopped: true }]);
});
