import test from 'node:test';
import assert from 'node:assert/strict';
import { configForTask, modelForTask, PROVIDERS } from '../lib/ai.mjs';
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
