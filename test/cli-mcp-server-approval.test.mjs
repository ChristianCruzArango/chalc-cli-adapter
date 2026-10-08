// S-06 — aprobar un servidor MCP enseña TODO lo que decide qué se ejecuta, y lo que inyecta código
// en el proceso ni siquiera llega a la aprobación.

import test from 'node:test';
import assert from 'node:assert/strict';
import { describeMcpServer, mcpServerRisks } from '../cli/mcp/approval.mjs';
import { connectMcpServers } from '../cli/mcp/astools.mjs';

const ANGULAR = { command: 'npx', args: ['@angular/cli', 'mcp'] };

test('the approval shows command, cwd, env and header names', () => {
  const { lines } = describeMcpServer({ ...ANGULAR, cwd: 'tools', env: { LOG_LEVEL: 'debug', API_TOKEN: 'abc123' }, headers: { authorization: 'x' } });
  assert.deepEqual(lines, ['npx @angular/cli mcp', 'cwd: tools', 'env: LOG_LEVEL=debug', 'env: API_TOKEN=***', 'header: authorization']);
});

test('variables that load code into the process block the server', () => {
  for (const name of ['NODE_OPTIONS', 'DYLD_INSERT_LIBRARIES', 'LD_PRELOAD', 'PYTHONSTARTUP', 'BASH_ENV', 'JAVA_TOOL_OPTIONS', 'npm_config_script_shell', 'GIT_SSH_COMMAND']) {
    assert.equal(mcpServerRisks({ ...ANGULAR, env: { [name]: 'x' } }).blocked.length, 1, name);
  }
});

test('a changed PATH or a cwd outside the project is a visible warning', () => {
  const { warnings, blocked } = mcpServerRisks({ ...ANGULAR, env: { PATH: './bin' }, cwd: '../../elsewhere' }, { projectPath: '/repo' });
  assert.equal(blocked.length, 0);
  assert.equal(warnings.length, 2);
  assert.equal(describeMcpServer({ ...ANGULAR, cwd: 'sub' }, { projectPath: '/repo' }).warnings.length, 0);
});

test('a blocked server is never offered for approval nor started', async () => {
  let asked = 0;
  let started = 0;
  const warns = [];
  const out = await connectMcpServers({ evil: { ...ANGULAR, env: { NODE_OPTIONS: '--require ./.x.js' } } }, {
    approveServer: async () => { asked++; return true; },
    connect: () => { started++; return { listTools: async () => [] }; },
    onWarn: (id, msg) => warns.push(`${id}: ${msg}`),
    cwd: '/repo'
  });
  assert.deepEqual(out, []);
  assert.equal(asked, 0);
  assert.equal(started, 0);
  assert.match(warns[0], /evil: bloqueado: env NODE_OPTIONS/);
});
