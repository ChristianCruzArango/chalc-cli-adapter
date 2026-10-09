// V-08 (spec 016, R10) — la aprobación de servidores MCP falla en CERRADO: sin aprobador inyectado, el
// `.mcp.json` de un repo ajeno no arranca nada. Quien use la API programática (runTask) puede seguir
// usando MCP pasando su propio aprobador.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connectMcpServers } from '../cli/mcp/astools.mjs';
import { createSession, runTask } from '../cli/session.mjs';
import { t } from '../lib/i18n.mjs';

const fakeClient = () => ({ start: async () => {}, listTools: async () => [], stop: async () => {} });

async function projectWithMcp() {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-v08-'));
  await writeFile(join(dir, '.chalc.json'), JSON.stringify({ target: 'claude', skills: [], mcp: ['repo'] }));
  await writeFile(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { repo: { command: 'server-del-repo' } } }));
  return dir;
}

const done = async () => '{"done":true,"summary":"ok"}';

test('R10: without an approver no MCP server is started, and the reason is reported', async () => {
  let spawned = 0;
  const warned = [];
  const conns = await connectMcpServers({ repo: { command: 'x' } }, {
    connect: () => { spawned++; return fakeClient(); },
    onWarn: (id, msg) => warned.push([id, msg])
  });
  assert.deepEqual(conns, []);
  assert.equal(spawned, 0);
  assert.deepEqual(warned, [['repo', t('cliMcpNoApprover')]]);
});

test('R10: an explicit approver keeps working (approved starts, rejected does not)', async () => {
  let spawned = 0;
  const conns = await connectMcpServers({ ok: { command: 'a' }, no: { command: 'b' } }, {
    connect: () => { spawned++; return fakeClient(); },
    approveServer: async (id) => id === 'ok'
  });
  assert.deepEqual(conns.map((c) => c.id), ['ok']);
  assert.equal(spawned, 1);
});

test('R10: createSession without approveMcpServer does not run the repo MCP servers', async () => {
  const dir = await projectWithMcp();
  try {
    let spawned = 0;
    const session = await createSession({ projectPath: dir, chatImpl: done, language: 'es', mcpConnect: () => { spawned++; return fakeClient(); } });
    assert.equal(spawned, 0);
    assert.deepEqual(session.mcp, []);
    await session.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('R10: runTask does not run MCP by default, and forwards approveMcpServer when given', async () => {
  const dir = await projectWithMcp();
  try {
    const plain = await runTask({ projectPath: dir, task: 'x', chatImpl: done, language: 'es' });
    assert.equal(plain.result.done, true);
    const asked = [];
    const approved = await runTask({
      projectPath: dir, task: 'x', chatImpl: done, language: 'es',
      approveMcpServer: async (id) => { asked.push(id); return false; }
    });
    assert.equal(approved.result.done, true);
    assert.deepEqual(asked, ['repo']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
