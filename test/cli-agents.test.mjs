import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentRegistry } from '../cli/agents/registry.mjs';
import { renderAgents } from '../cli/ui/agents.mjs';
import { stripAnsi } from '../cli/ui/render.mjs';

test('registro de agentes sigue ciclo, herramienta y duración sin exponer pensamiento', () => {
  let now = 1000;
  const realNow = Date.now;
  Date.now = () => now;
  try {
    const agents = createAgentRegistry({ roles: { coder: { model: 'qwen', provider: 'ollama' } } });
    const id = agents.begin({ role: 'coder', task: 'crear login', model: 'qwen', provider: 'ollama' });
    agents.step(id, { action: { tool: 'read', args: { path: 'src/login.ts' } }, observation: { content: 'x' } });
    let run = agents.snapshot().agents.find((a) => a.role === 'coder');
    assert.equal(run.status, 'running');
    assert.equal(run.currentAction, 'read src/login.ts');
    assert.equal(run.steps.length, 1);
    now = 4000;
    agents.finish(id, { done: true });
    run = agents.snapshot().agents.find((a) => a.role === 'coder');
    assert.equal(run.status, 'completed');
    assert.equal(run.finishedAt, 4000);
  } finally { Date.now = realNow; }
});

test('registro representa espera de aprobación y fallo', () => {
  const agents = createAgentRegistry();
  const id = agents.begin({ role: 'planner', task: 'planear' });
  agents.update(id, { status: 'waiting_approval', currentAction: 'bash npm test' });
  assert.equal(agents.active('planner'), id);
  agents.fail(id, new Error('modelo caído'));
  const run = agents.snapshot().agents.find((a) => a.role === 'planner');
  assert.equal(run.status, 'failed');
  assert.equal(run.error, 'modelo caído');
});

test('renderAgents produce gráfico adaptativo con los tres roles', () => {
  const agents = createAgentRegistry({ roles: {
    planner: { model: 'opus', provider: 'openrouter' }, coder: { model: 'qwen', provider: 'ollama' }
  } });
  const id = agents.begin({ role: 'coder', task: 'implementar /agents', model: 'qwen', provider: 'ollama' });
  agents.step(id, { action: { tool: 'edit', args: { path: 'cli/index.mjs' } }, observation: { ok: true } });
  const out = stripAnsi(renderAgents(agents.snapshot(), { language: 'es', width: 72, now: Date.now() }));
  assert.match(out, /AGENTES/);
  assert.match(out, /Líder/);
  assert.match(out, /Desarrollador/);
  assert.match(out, /Revisor/);
  assert.match(out, /edit cli\/index\.mjs/);
  assert.match(out, /trabajando/);
});
