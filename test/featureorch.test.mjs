import test from 'node:test';
import assert from 'node:assert/strict';
import { orchestrateFeature } from '../lib/featureorch.mjs';

test('orchestrateFeature: contract first, then back spec, then front spec (each with the contract)', async () => {
  const calls = [];
  const fakeContract = async (_cfg, opts) => {
    calls.push({ kind: 'contract', backStack: opts.backStack, frontStack: opts.frontStack });
    return { contract: '## Requisitos compartidos\n- R1 — login', trace: { system: 's', raw: 'r' } };
  };
  const fakeSpec = async (_cfg, opts) => {
    calls.push({ kind: 'spec', documentText: opts.documentText });
    return { feature: 'login', files: { 'spec.md': '# spec', 'plan.md': '# plan', 'tasks.md': '# tasks' }, validation: [] };
  };

  const res = await orchestrateFeature({
    cfg: {}, userStory: 'Como usuario quiero iniciar sesión.', language: 'español',
    back: { stack: 'NestJS', templates: {}, constitution: '' },
    front: { stack: 'Angular', templates: {}, constitution: '' },
    generateContractImpl: fakeContract, generateSpecImpl: fakeSpec
  });

  // orden: contrato → back → front
  assert.deepEqual(calls.map((c) => c.kind), ['contract', 'spec', 'spec']);
  // el contrato vio ambos stacks
  assert.equal(calls[0].backStack, 'NestJS');
  assert.equal(calls[0].frontStack, 'Angular');
  // el doc del back lleva rol BACKEND + el contrato + la HU
  assert.match(calls[1].documentText, /<role>BACKEND<\/role>/);
  assert.match(calls[1].documentText, /R1 — login/);             // contrato compartido embebido
  assert.match(calls[1].documentText, /iniciar sesión/);
  // el doc del front lleva rol FRONTEND + el mismo contrato
  assert.match(calls[2].documentText, /<role>FRONTEND<\/role>/);
  assert.match(calls[2].documentText, /R1 — login/);
  // resultado estructurado
  assert.match(res.contract, /R1/);
  assert.ok(res.back.files['spec.md'] && res.front.files['spec.md']);
});

test('orchestrateFeature rejects an empty user story', async () => {
  await assert.rejects(() => orchestrateFeature({ cfg: {}, userStory: '   ', back: {}, front: {} }), /vac/i);
});
