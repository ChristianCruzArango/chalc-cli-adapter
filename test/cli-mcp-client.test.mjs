// Tests de cli/mcp/client.mjs contra un servidor MCP FALSO real (proceso node): cubren el transporte
// stdio por líneas, el handshake y —lo crítico— que la muerte del server a mitad de sesión rechace los
// requests en vez de tumbar el CLI con un EPIPE no capturado.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createStdioClient } from '../cli/mcp/client.mjs';

// Servidor MCP mínimo: responde initialize y tools/list; MUERE al recibir tools/call.
const SERVER = `
import { createInterface } from 'node:readline';
const rl = createInterface({ input: process.stdin });
const respond = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n');
console.error('log que no es JSON');   // el cliente debe ignorar stderr y líneas no-JSON
rl.on('line', (l) => {
  let m; try { m = JSON.parse(l); } catch { return; }
  if (m.method === 'initialize') respond(m.id, { capabilities: {} });
  else if (m.method === 'tools/list') respond(m.id, { tools: [{ name: 'ping', description: 'pong' }] });
  else if (m.method === 'tools/call') process.exit(1);
});
`;

test('createStdioClient: handshake y tools/list contra un server real por stdio', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-mcp-'));
  const file = join(dir, 'server.mjs');
  await writeFile(file, SERVER, 'utf8');
  const client = createStdioClient({ command: process.execPath, args: [file], timeoutMs: 8000 });
  try {
    await client.start();
    const tools = await client.listTools();
    assert.equal(tools[0].name, 'ping');
  } finally {
    await client.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test('createStdioClient: si el server muere a mitad de sesión, los requests rechazan (no crashea el CLI)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-mcp-'));
  const file = join(dir, 'server.mjs');
  await writeFile(file, SERVER, 'utf8');
  const client = createStdioClient({ command: process.execPath, args: [file], timeoutMs: 3000 });
  try {
    await client.start();
    await assert.rejects(() => client.callTool('ping', {}));   // el server hace exit(1) al recibirlo
    // Un request POSTERIOR sobre el server muerto también debe rechazar (EPIPE manejado), no colgar ni tumbar.
    await assert.rejects(() => client.listTools());
  } finally {
    await client.stop();
    await rm(dir, { recursive: true, force: true });
  }
});
