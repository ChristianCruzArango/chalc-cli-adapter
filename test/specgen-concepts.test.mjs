// spec 015 · T14 (R9) — la spec que genera chalc también declara sus conceptos.
//
// Venga la HU del proyecto o de `chalc spec-ia` / `chalc feature`, la spec tiene que nombrar sus
// conceptos con el MISMO vocabulario que ya usa la memoria del repo. Por eso el prompt recibe la lista
// existente, y la validación avisa si la spec generada no trae su línea.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt } from '../lib/specgen.mjs';
import { validateGeneratedSpec } from '../lib/specvalidate.mjs';
import { orchestrateFeature } from '../lib/featureorch.mjs';

const CONCEPTS = ['dinero — dinero, plata, money', 'fechas — fecha, date, hora'];

test('R9: the spec prompt receives the concept list of the target repo', async () => {
  const { system } = await buildPrompt({ language: 'español', mode: 'lite', documentText: 'HU', templates: {}, concepts: CONCEPTS });
  assert.match(system, /dinero — dinero, plata, money/);
  assert.match(system, /Conceptos:/);
});

test('R9: with no concepts yet the prompt still asks for the line', async () => {
  const { system } = await buildPrompt({ language: 'español', mode: 'lite', documentText: 'HU', templates: {} });
  assert.match(system, /Conceptos:/);
});

const SPEC = (head) => `${head}\n- **R1** — WHEN algo THE SYSTEM SHALL otra cosa.\n`;
const TASKS = '- [ ] **T1** (R1) — Hacer algo.\n';

test('R9: a generated spec without its concepts line is flagged', () => {
  const issues = validateGeneratedSpec({ 'spec.md': SPEC('# Spec: x'), 'plan.md': 'plan', 'tasks.md': TASKS });
  assert.ok(issues.some((i) => i.code === 'no-concepts' && i.level === 'warn'));
});

test('R9: a generated spec with its concepts line, in either language, is not flagged', () => {
  for (const head of ['# Spec: x\n\nConceptos: dinero', '# Spec: x\n\nConcepts: money']) {
    const issues = validateGeneratedSpec({ 'spec.md': SPEC(head), 'plan.md': 'plan', 'tasks.md': TASKS });
    assert.ok(!issues.some((i) => i.code === 'no-concepts'), head);
  }
});

test('R9: chalc feature passes each side its own concept list', async () => {
  const seen = [];
  await orchestrateFeature({
    cfg: {}, userStory: 'Como cliente quiero pagar',
    back: { stack: 'node', concepts: ['dinero — dinero'] }, front: { stack: 'angular', concepts: ['fechas — fecha'] },
    generateContractImpl: async () => ({ contract: '', trace: null }),
    generateSpecImpl: async (cfg, opts) => { seen.push(opts.concepts); return {}; }
  });
  assert.deepEqual(seen, [['dinero — dinero'], ['fechas — fecha']]);
});
