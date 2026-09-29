import test from 'node:test';
import assert from 'node:assert/strict';
import { mcpServerIssues } from '../lib/commands/doctor.mjs';

const messages = (server) => mcpServerIssues('demo', server).map((i) => i.message);

test('a local MCP needs a command without shell syntax', () => {
  assert.deepEqual(messages({ command: 'railway', args: ['mcp'] }), []);
  assert.deepEqual(messages({}), ['demo no tiene server.command ni server.url']);
  assert.deepEqual(messages({ command: 'rm -rf /' }), ['demo.server.command no debe incluir espacios ni sintaxis de shell']);
});

test('a remote MCP is accepted only over https', () => {
  assert.deepEqual(messages({ type: 'http', url: 'https://docs.typesafe.ai/mcp' }), []);
  assert.deepEqual(messages({ url: 'http://docs.typesafe.ai/mcp' }), ['demo.server.url debe ser una URL https']);
  assert.deepEqual(messages({ url: 42 }), ['demo.server.url debe ser una URL https']);
});

test('an MCP cannot be local and remote at the same time', () => {
  assert.deepEqual(messages({ command: 'node', url: 'https://example.com/mcp' }), [
    'demo no puede tener server.command y server.url a la vez'
  ]);
});
