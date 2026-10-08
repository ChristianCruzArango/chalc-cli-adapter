import test from 'node:test';
import assert from 'node:assert/strict';
import { mcpServerIssues } from '../lib/commands/doctor.mjs';
import { t } from '../lib/i18n.mjs';

const messages = (server) => mcpServerIssues('demo', server).map((i) => i.message);

test('a local MCP needs a command without shell syntax', () => {
  assert.deepEqual(messages({ command: 'railway', args: ['mcp'] }), []);
  assert.deepEqual(messages({}), [t('drMcpNone', 'demo')]);
  assert.deepEqual(messages({ command: 'rm -rf /' }), [t('drMcpShellCmd', 'demo')]);
});

test('a remote MCP is accepted only over https', () => {
  assert.deepEqual(messages({ type: 'http', url: 'https://docs.typesafe.ai/mcp' }), []);
  assert.deepEqual(messages({ url: 'http://docs.typesafe.ai/mcp' }), [t('drMcpHttps', 'demo')]);
  assert.deepEqual(messages({ url: 42 }), [t('drMcpHttps', 'demo')]);
});

test('an MCP cannot be local and remote at the same time', () => {
  assert.deepEqual(messages({ command: 'node', url: 'https://example.com/mcp' }), [
    t('drMcpBoth', 'demo')
  ]);
});
