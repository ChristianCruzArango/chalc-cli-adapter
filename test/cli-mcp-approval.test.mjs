import test from 'node:test';
import assert from 'node:assert/strict';
import { createApprovalPolicy, isReadOnlyMcpTool, normalizeMcpApprovalMode } from '../cli/mcp/approval.mjs';

test('normalizeMcpApprovalMode acepta sinónimos explícitos y un valor desconocido cae en el modo más estricto', () => {
  assert.equal(normalizeMcpApprovalMode('always'), 'always');
  assert.equal(normalizeMcpApprovalMode('strict'), 'always');
  assert.equal(normalizeMcpApprovalMode('per-action'), 'always');
  assert.equal(normalizeMcpApprovalMode('write'), 'mutating');
  assert.equal(normalizeMcpApprovalMode('read-only'), 'mutating');
  assert.equal(normalizeMcpApprovalMode(''), 'always');            // sin valor → default seguro
  assert.equal(normalizeMcpApprovalMode('desconocido'), 'always'); // typo → fail-safe (estricto), no permisivo
});

test('isReadOnlyMcpTool clasifica por el nombre real de la tool MCP', () => {
  assert.equal(isReadOnlyMcpTool('mcp__ng__list_projects'), true);
  assert.equal(isReadOnlyMcpTool('mcp__ng__search_documentation'), true);
  assert.equal(isReadOnlyMcpTool('mcp__ng__generate_component'), false);
  assert.equal(isReadOnlyMcpTool('bash'), false);
});

test('isReadOnlyMcpTool NO auto-aprueba nombres mutantes que empiezan por un verbo de lectura', () => {
  assert.equal(isReadOnlyMcpTool('mcp__db__get_or_create_user'), false); // 'create' delata mutación
  assert.equal(isReadOnlyMcpTool('mcp__fs__read_and_write'), false);     // 'write'
  assert.equal(isReadOnlyMcpTool('mcp__q__list_and_purge'), false);      // 'purge'
  assert.equal(isReadOnlyMcpTool('mcp__db__getOrCreateUser'), false);    // camelCase: 'get' no es segmento
  assert.equal(isReadOnlyMcpTool('mcp__x__document_delete'), false);     // 'doc' ya no cuenta como lectura
  assert.equal(isReadOnlyMcpTool('mcp__x__docker_run'), false);          // 'docker' no es 'read'
});

test('needsApproval aplica default-deny a tools locales no catalogadas (fail-closed)', () => {
  const policy = createApprovalPolicy({ mcpMode: 'mutating' });
  assert.equal(policy.needsApproval('read'), false);   // lectura conocida → libre
  assert.equal(policy.needsApproval('list'), false);
  assert.equal(policy.needsApproval('grep'), false);
  assert.equal(policy.needsApproval('move'), true);        // tool local nueva/mutante → aprobación
  assert.equal(policy.needsApproval('apply_patch'), true);
  assert.equal(policy.needsApproval('rm'), true);
});

test('createApprovalPolicy en modo mutating pregunta solo por writes/bash y MCP no-lectura', () => {
  const policy = createApprovalPolicy({ mcpMode: 'mutating' });
  assert.equal(policy.mcpMode, 'mutating');
  assert.equal(policy.needsApproval('read'), false);
  assert.equal(policy.needsApproval('write'), true);
  assert.equal(policy.needsApproval('bash'), true);
  assert.equal(policy.needsApproval('mcp__ng__list_projects'), false);
  assert.equal(policy.needsApproval('mcp__ng__generate_component'), true);
});

test('createApprovalPolicy en modo always pregunta por toda tool MCP', () => {
  const policy = createApprovalPolicy({ mcpMode: 'always' });
  assert.equal(policy.mcpMode, 'always');
  assert.equal(policy.needsApproval('mcp__ng__list_projects'), true);
  assert.equal(policy.needsApproval('mcp__ng__generate_component'), true);
  assert.equal(policy.needsApproval('grep'), false);
});

test('createApprovalPolicy usa aprobación por llamada MCP como default seguro', () => {
  const policy = createApprovalPolicy();
  assert.equal(policy.mcpMode, 'always');
  assert.equal(policy.needsApproval('mcp__ng__list_projects'), true);
});
