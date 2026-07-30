import test from 'node:test';
import assert from 'node:assert/strict';
import { orchestrateFeature, orchestrateFeatures } from '../lib/featureorch.mjs';

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

// R5 — con repo móvil: contrato → back → front → móvil, rol MOBILE con contrato y HU embebidos.
test('orchestrateFeature with mobile: contract sees the mobile stack and a MOBILE spec comes last', async () => {
  const calls = [];
  const fakeContract = async (_cfg, opts) => {
    calls.push({ kind: 'contract', backStack: opts.backStack, frontStack: opts.frontStack, mobileStack: opts.mobileStack });
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
    mobile: { stack: 'Flutter + Dart', templates: {}, constitution: '' },
    generateContractImpl: fakeContract, generateSpecImpl: fakeSpec
  });

  // orden: contrato → back → front → móvil
  assert.deepEqual(calls.map((c) => c.kind), ['contract', 'spec', 'spec', 'spec']);
  // el contrato conoce al consumidor móvil (R4)
  assert.equal(calls[0].mobileStack, 'Flutter + Dart');
  // el doc del móvil lleva rol MOBILE + el mismo contrato + la HU, y habla de consumir (no reimplementar)
  assert.match(calls[3].documentText, /<role>MOBILE<\/role>/);
  assert.match(calls[3].documentText, /R1 — login/);
  assert.match(calls[3].documentText, /iniciar sesión/);
  assert.match(calls[3].documentText, /Flutter \+ Dart/);
  // resultado estructurado con el lado móvil
  assert.ok(res.mobile.files['spec.md']);
});

// R10 — sin móvil, nada cambia: dos specs y `mobile` nulo.
test('orchestrateFeature without mobile keeps the two-spec flow and returns mobile: null', async () => {
  const calls = [];
  const fakeContract = async (_cfg, opts) => {
    calls.push({ kind: 'contract', mobileStack: opts.mobileStack });
    return { contract: 'C', trace: {} };
  };
  const fakeSpec = async () => { calls.push({ kind: 'spec' }); return { feature: 'x', files: {}, validation: [] }; };

  const res = await orchestrateFeature({
    cfg: {}, userStory: 'HU', back: { stack: 'Go' }, front: { stack: 'Angular' },
    generateContractImpl: fakeContract, generateSpecImpl: fakeSpec
  });

  assert.deepEqual(calls.map((c) => c.kind), ['contract', 'spec', 'spec']);
  assert.equal(calls[0].mobileStack, undefined);   // el orquestador no inventa un stack móvil
  assert.equal(res.mobile, null);
});

// ---------- spec 005: multi-HU (orchestrateFeatures) ----------

// R7 — secuencial: el contrato de la HU N recibe los contratos 1..N-1 en su contexto.
test('orchestrateFeatures feeds prior contracts into the next contract call', async () => {
  const contractCalls = [];
  let n = 0;
  const fakeContract = async (_cfg, opts) => {
    contractCalls.push(opts.backContext);
    n += 1;
    return { contract: `CONTRATO-${n}`, trace: { system: 's', raw: 'r' } };
  };
  const fakeSpec = async () => ({ feature: `feat-${n}`, files: { 'spec.md': '# s' }, validation: [] });

  const results = await orchestrateFeatures({
    cfg: {}, userStories: ['HU uno', 'HU dos', 'HU tres'], language: 'español',
    back: { stack: 'NestJS' }, front: { stack: 'Angular' }, backContext: 'ARQUITECTURA',
    generateContractImpl: fakeContract, generateSpecImpl: fakeSpec
  });

  assert.equal(results.length, 3);
  // HU-1: solo el contexto del back, sin contratos previos
  assert.match(contractCalls[0], /ARQUITECTURA/);
  assert.doesNotMatch(contractCalls[0], /CONTRATO-/);
  // HU-2 ve el contrato 1; HU-3 ve el 1 y el 2 (y nunca el suyo)
  assert.match(contractCalls[1], /CONTRATO-1/);
  assert.match(contractCalls[2], /CONTRATO-1/);
  assert.match(contractCalls[2], /CONTRATO-2/);
  assert.doesNotMatch(contractCalls[2], /CONTRATO-3/);
  // cada resultado conserva su HU y su contrato
  assert.equal(results[1].userStory, 'HU dos');
  assert.equal(results[1].contract, 'CONTRATO-2');
  assert.ok(results[2].back.files['spec.md']);
});

// R7 — AISLAMIENTO entre HUs: las specs de una HU ven SOLO su contrato y su historia.
// Ni las otras HUs ni los contratos previos llegan jamás al prompt de una spec (no se mezclan
// historias); los contratos previos solo entran, como referencia, al prompt del CONTRATO.
test('orchestrateFeatures keeps each story spec isolated from the other stories', async () => {
  const specDocs = [];
  let n = 0;
  const fakeContract = async () => { n += 1; return { contract: `CONTRATO-${n}`, trace: {} }; };
  const fakeSpec = async (_cfg, opts) => {
    specDocs.push(opts.documentText);
    return { feature: `feat-${n}`, files: { 'spec.md': '# s' }, validation: [] };
  };

  await orchestrateFeatures({
    cfg: {}, userStories: ['HU-LOGIN única', 'HU-REPORTES única'], language: 'español',
    back: { stack: 'NestJS' }, front: { stack: 'Angular' },
    generateContractImpl: fakeContract, generateSpecImpl: fakeSpec
  });

  const [back1, front1, back2, front2] = specDocs;
  // las specs de la HU-1 llevan SU historia y SU contrato, y nada de la HU-2
  for (const doc of [back1, front1]) {
    assert.match(doc, /HU-LOGIN única/);
    assert.match(doc, /CONTRATO-1/);
    assert.doesNotMatch(doc, /HU-REPORTES/);
    assert.doesNotMatch(doc, /CONTRATO-2/);
  }
  // las specs de la HU-2 llevan SU historia y SU contrato, y nada de la HU-1 (ni su contrato)
  for (const doc of [back2, front2]) {
    assert.match(doc, /HU-REPORTES única/);
    assert.match(doc, /CONTRATO-2/);
    assert.doesNotMatch(doc, /HU-LOGIN/);
    assert.doesNotMatch(doc, /CONTRATO-1\b/);
  }
});

// R5 — una sola HU: mismo resultado que el orquestador simple, en lista de uno.
test('orchestrateFeatures with one story behaves like the single orchestrator', async () => {
  const fakeContract = async () => ({ contract: 'C', trace: {} });
  const fakeSpec = async () => ({ feature: 'x', files: { 'spec.md': '# s' }, validation: [] });
  const results = await orchestrateFeatures({
    cfg: {}, userStories: ['HU'], back: { stack: 'Go' }, front: { stack: 'Vue' },
    generateContractImpl: fakeContract, generateSpecImpl: fakeSpec
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].contract, 'C');
  assert.equal(results[0].mobile, null);
});

// R5 — sin HUs: error claro, sin llamadas de IA.
test('orchestrateFeatures rejects an empty story list', async () => {
  await assert.rejects(() => orchestrateFeatures({ cfg: {}, userStories: [], back: {}, front: {} }), /HU|histor/i);
});
