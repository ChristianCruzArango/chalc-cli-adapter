import test from 'node:test';
import assert from 'node:assert/strict';
import { configForTask, modelForTask, applyProfileModels, PROVIDERS } from '../lib/ai.mjs';
import { makeAiTrace } from '../lib/aitrace.mjs';
import { validateGeneratedSpec, summarizeValidation } from '../lib/specvalidate.mjs';
import { runLocalAiEvals } from '../lib/aieval.mjs';

test('AI provider defaults are known-valid model ids (no 404 traps)', () => {
  assert.equal(PROVIDERS.openai.defaultModel, 'gpt-4o');
  assert.equal(PROVIDERS.anthropic.defaultModel, 'claude-sonnet-4-6');
  assert.equal(PROVIDERS.google.defaultModel, 'gemini-2.0-flash');
});

test('configForTask resolves task-specific models before default model', () => {
  const cfg = { provider: 'openai', model: 'default-model', models: { spec: 'spec-model' } };
  assert.equal(modelForTask(cfg, 'spec'), 'spec-model');
  assert.equal(configForTask(cfg, 'spec').model, 'spec-model');
  assert.equal(configForTask(cfg, 'qa').model, 'default-model');
});

test('applyProfileModels fills per-task models for cloud providers', () => {
  const profile = { id: 'p', models: { spec: { openai: 'gpt-4o' }, qa: { openai: 'gpt-4o-mini' } } };
  const out = applyProfileModels({ provider: 'openai', model: 'x' }, profile);
  assert.equal(out.models.spec, 'gpt-4o');
  assert.equal(out.models.qa, 'gpt-4o-mini');
});

test('applyProfileModels never imposes a fixed model on local providers (Ollama): chosen model wins', () => {
  const profile = { id: 'p', models: { spec: { ollama: 'llama3.1' }, qa: { ollama: 'llama3.1' } } };
  const out = applyProfileModels({ provider: 'ollama', model: 'qwen2.5-coder:7b' }, profile);
  // No debe quedar models.spec = llama3.1 (que quizá no esté instalado y reventaría).
  assert.equal(out.models?.spec, undefined);
  assert.equal(modelForTask(out, 'spec'), 'qwen2.5-coder:7b');
  assert.equal(modelForTask(out, 'qa'), 'qwen2.5-coder:7b');
});

test('AI traces hash prompt/output content without storing raw text', () => {
  const trace = makeAiTrace({ task: 'spec', provider: 'openai', model: 'gpt', system: 'secret system', user: 'secret user', output: 'secret output' });
  assert.equal(trace.systemHash.length, 64);
  assert.equal(trace.userHash.length, 64);
  assert.equal(trace.outputHash.length, 64);
  assert.equal(JSON.stringify(trace).includes('secret system'), false);
});

test('generated spec validation catches structural regressions', () => {
  const issues = validateGeneratedSpec({
    'spec.md': '**R1** — WHEN a user logs in THE SYSTEM SHALL show home.',
    'plan.md': 'Plan',
    'tasks.md': '- [ ] Test R2'
  });
  assert.equal(summarizeValidation(issues).ok, false);
  assert.ok(issues.some((i) => i.code === 'unknown-task-ref'));
});

test('local AI eval suite passes its prompt/parser contracts', () => {
  const checks = runLocalAiEvals();
  assert.ok(checks.length >= 4);
  assert.equal(checks.every((item) => item.ok), true);
});
