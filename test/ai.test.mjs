import test from 'node:test';
import assert from 'node:assert/strict';
import { configForTask, modelForTask, applyProfileModels, isStaleModel, pruneStaleModels, PROVIDERS } from '../lib/ai.mjs';
import { roleConfig, roleModelLabel } from '../cli/session.mjs';
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

// Cambiar el proveedor base (ollama → openrouter) dejaba los modelos por tarea del anterior:
// se enviaban tal cual y la API respondía 400 "gpt-oss:20b is not a valid model ID".
test('per-task models saved for another provider never reach the API', () => {
  const cfg = { provider: 'openrouter', model: 'anthropic/claude-sonnet-4.6', models: { spec: 'gpt-oss:20b', qa: 'qwen3-coder:30b' } };
  assert.equal(isStaleModel(cfg, 'gpt-oss:20b'), true);
  assert.equal(modelForTask(cfg, 'spec'), 'anthropic/claude-sonnet-4.6');
  assert.equal(configForTask(cfg, 'qa').model, 'anthropic/claude-sonnet-4.6');
  assert.deepEqual(pruneStaleModels(cfg), {});
});

test('a per-task model stamped for the current provider is respected as-is', () => {
  const cfg = { provider: 'openrouter', model: 'anthropic/claude-sonnet-4.6', modelsFor: 'openrouter', models: { spec: 'openai/gpt-5.5' } };
  assert.equal(isStaleModel(cfg, 'openai/gpt-5.5', cfg.modelsFor), false);
  assert.equal(modelForTask(cfg, 'spec'), 'openai/gpt-5.5');
  // el sello manda sobre la heurística del nombre: si el usuario lo fijó aquí, se usa
  assert.equal(isStaleModel({ ...cfg, models: { spec: 'raro:tag' } }, 'raro:tag', 'openrouter'), false);
});

test('the stamp catches stale models even when the name looks cloud-shaped', () => {
  const cfg = { provider: 'openrouter', model: 'anthropic/claude-sonnet-4.6', modelsFor: 'openai', models: { spec: 'gpt-4o' } };
  assert.equal(modelForTask(cfg, 'spec'), 'anthropic/claude-sonnet-4.6');
});

test('local providers keep their own model names (nothing is stale on Ollama)', () => {
  const cfg = { provider: 'ollama', model: 'gpt-oss:20b', models: { spec: 'qwen3-coder:30b' } };
  assert.equal(isStaleModel(cfg, 'qwen3-coder:30b'), false);
  assert.equal(modelForTask(cfg, 'spec'), 'qwen3-coder:30b');
});

test('applyProfileModels drops the previous provider models and stamps the current one', () => {
  const profile = { id: 'p', models: { spec: { openrouter: 'anthropic/claude-opus-4.8' } } };
  const out = applyProfileModels({ provider: 'openrouter', model: 'anthropic/claude-sonnet-4.6', models: { spec: 'gpt-oss:20b', qa: 'qwen3-coder:30b' } }, profile);
  assert.equal(out.models.spec, 'anthropic/claude-opus-4.8');
  assert.equal(out.models.qa, undefined);
  assert.equal(out.modelsFor, 'openrouter');
  assert.equal(modelForTask(out, 'qa'), 'anthropic/claude-sonnet-4.6');
});

test('cli roles pinned as plain strings fall back to the base model after a provider switch', () => {
  const cfg = {
    provider: 'openrouter', model: 'anthropic/claude-sonnet-4.6',
    cli: { roles: { coder: 'qwen3-coder:30b', planner: { provider: 'openrouter', model: 'anthropic/claude-opus-4.8', apiKey: 'k' } } }
  };
  assert.equal(roleConfig(cfg, 'coder'), null);              // null = usa el impl base
  assert.equal(roleModelLabel(cfg, 'coder'), null);          // y la UI no miente sobre el modelo
  assert.equal(roleConfig(cfg, 'planner').model, 'anthropic/claude-opus-4.8');   // rol con proveedor propio: intacto
  // ya sellado para este proveedor: el string se respeta
  const stamped = { ...cfg, cli: { ...cfg.cli, rolesFor: 'openrouter' } };
  assert.equal(roleConfig(stamped, 'coder').model, 'qwen3-coder:30b');
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
