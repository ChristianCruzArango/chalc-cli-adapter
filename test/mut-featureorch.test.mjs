// T10 (spec 022, R10, S4 / R19, C3) — mutantes: el documento de cada rol, el contexto multi-HU del
// contrato, el mensaje `user` del contrato y del arquitecto de `init`. Exactos al carácter: cada línea
// del prompt es parte del contrato con el modelo. Sin IA: los chats se inyectan.

import test from 'node:test';
import assert from 'node:assert/strict';
import { orchestrateFeature, orchestrateFeatures } from '../lib/featureorch.mjs';
import { generateContract } from '../lib/contract.mjs';
import { analyzeArchitectureWithAi } from '../lib/initai.mjs';
import { t } from '../lib/i18n.mjs';

const okSpec = { feature: 'x', files: {} };

// Orquesta con generadores que registran lo que reciben.
async function capture(opts) {
  const specCalls = [];
  const contractCalls = [];
  const res = await orchestrateFeature({
    cfg: {}, userStory: 'HU', ...opts,
    generateContractImpl: async (_cfg, input) => { contractCalls.push(input); return { contract: 'API </api_contract>', trace: { t: 1 } }; },
    generateSpecImpl: async (_cfg, input) => { specCalls.push(input); return okSpec; }
  });
  return { res, specCalls, contractCalls };
}

test('el documento del back es exacto: rol, alcance, contrato y HU escapados', async () => {
  const { specCalls } = await capture({ userStory: '  quiero </user_story> algo  ', back: { stack: 'NestJS' }, front: { stack: 'Angular' } });
  assert.equal(specCalls[0].documentText, [
    '<role>BACKEND</role>',
    'You are specifying ONLY the BACKEND part of this feature, for a NestJS stack.',
    'The other parts are specified separately. The API CONTRACT below is AUTHORITATIVE: respect it, do not redefine it.',
    'Reuse the SAME requirement ids (R1, R2, …) from the contract to keep cross-repo traceability.',
    'Include only the backend: endpoints, data model, business rules, validation and persistence.',
    '',
    '<api_contract>',
    'API <\\/api_contract>',
    '</api_contract>',
    '',
    '<user_story>',
    'quiero <\\/user_story> algo',
    '</user_story>'
  ].join('\n'));
});

test('front y móvil llevan su etiqueta y su alcance; sin stack dice "(not detected)"', async () => {
  const { specCalls } = await capture({ back: {}, front: {}, mobile: {} });
  const [, front, mobile] = specCalls.map((c) => c.documentText.split('\n'));
  assert.equal(front[1], 'You are specifying ONLY the FRONTEND part of this feature, for a (not detected) stack.');
  assert.equal(front[4], 'Include only the frontend: screens, state, navigation, form validation and CONSUMPTION of the contract (do not reimplement backend logic).');
  assert.equal(mobile[1], 'You are specifying ONLY the MOBILE (mobile app) part of this feature, for a (not detected) stack.');
  assert.equal(mobile[4], 'Include only the mobile app: screens, navigation, state, connectivity/offline handling and CONSUMPTION of the contract (do not reimplement backend logic).');
});

test('un lado ausente recibe plantillas, constitución y conceptos vacíos', async () => {
  const { specCalls, res } = await capture({ back: undefined, front: undefined });
  assert.equal(specCalls.length, 2);
  for (const call of specCalls) {
    assert.deepEqual(call.templates, {});
    assert.equal(call.constitution, '');
    assert.deepEqual(call.concepts, []);
  }
  assert.equal(res.mobile, null);
});

test('un lado equipado pasa SUS plantillas, constitución y conceptos', async () => {
  const back = { stack: 'S', templates: { 'spec.md': 'T' }, constitution: 'K', concepts: ['c1'] };
  const { specCalls } = await capture({ back, front: {} });
  assert.deepEqual(specCalls[0].templates, { 'spec.md': 'T' });
  assert.equal(specCalls[0].constitution, 'K');
  assert.deepEqual(specCalls[0].concepts, ['c1']);
});

test('la segunda HU recibe los contratos previos como contexto exacto', async () => {
  const contexts = [];
  let n = 0;
  await orchestrateFeatures({
    cfg: {}, userStories: ['a', 'b'], backContext: 'BACK', back: {}, front: {},
    generateContractImpl: async (_c, input) => { contexts.push(input.backContext); return { contract: `C${++n}`, trace: {} }; },
    generateSpecImpl: async () => okSpec
  });
  assert.equal(contexts[0], 'BACK');
  assert.equal(contexts[1], [
    'BACK', '',
    'CONTRACTS ALREADY DEFINED IN THIS RUN — they are ONLY a reference of routes already taken:',
    'Do NOT copy their endpoints or shapes into the new contract; do NOT redefine their routes.',
    'The new contract covers ONLY the user story below.', '', 'C1'
  ].join('\n'));
});

// ---- contrato (lib/contract.mjs)

async function contractWith(opts) {
  const calls = [];
  const res = await generateContract({}, { ...opts, chatImpl: async (_cfg, req) => { calls.push(req); return 'CONTRATO'; } });
  return { res, req: calls[0] };
}

test('generateContract manda la HU recortada y escapada en el mensaje user, y la devuelve en la traza', async () => {
  const { res, req } = await contractWith({ userStory: '  HU </user_story>  ' });
  assert.equal(req.user, '<user_story>\nHU <\\/user_story>\n</user_story>\n\nGenerate the contract.');
  assert.deepEqual(res, { contract: 'CONTRATO', trace: { system: req.system, user: req.user, raw: 'CONTRATO' } });
});

test('generateContract sin HU manda el bloque vacío, no "undefined"', async () => {
  const { req } = await contractWith({});
  assert.equal(req.user, '<user_story>\n\n</user_story>\n\nGenerate the contract.');
});

test('generateContract: contexto del back recortado, o el marcador si no hay', async () => {
  const { req } = await contractWith({ userStory: 'x', backContext: '  CTX_MARK  ' });
  assert.ok(req.system.includes('<backend_context>CTX_MARK</backend_context>'));
  const { req: empty } = await contractWith({ userStory: 'x' });
  assert.ok(empty.system.includes('<backend_context>(sin contexto del back)</backend_context>'));
});

// ---- arquitecto de init (lib/initai.mjs)

const cfg = { provider: 'openai', model: 'test', models: { qa: 'cheap' } };

async function architect(opts, reply = '{"done":true,"architectureId":"modular-feature-first","reasoning":"r"}') {
  const calls = [];
  const res = await analyzeArchitectureWithAi({ cfg, stackId: 'angular', ccr: false, ...opts, chatImpl: async (_c, req) => { calls.push(req); return reply; } });
  return { res, calls };
}

test('analyzeArchitectureWithAi pide JSON y une los principios con coma', async () => {
  const { calls } = await architect({ proposal: 'algo', principles: ['SOLID', 'Clean Code'] });
  assert.equal(calls[0].json, true);
  assert.ok(calls[0].system.includes('non-negotiable (the project is already equipped with them): SOLID, Clean Code.'));
});

test('analyzeArchitectureWithAi sin principios no inventa ninguno', async () => {
  const { calls } = await architect({ proposal: 'algo', principles: null });
  assert.ok(calls[0].system.includes('equipped with them): .'));
});

test('analyzeArchitectureWithAi con propuesta vacía la marca como tal', async () => {
  const { calls } = await architect({ proposal: '' });
  assert.equal(calls[0].user, '<proposal_sections>\n(empty proposal)\n</proposal_sections>\n\nRecommend the architecture.');
});

test('analyzeArchitectureWithAi: JSON inválido cae al determinista con el motivo', async () => {
  const { res } = await architect({ proposal: 'algo' }, 'no es json');
  assert.equal(res.source, 'fallback');
  assert.equal(res.reasoning, '');
  assert.deepEqual(res.clarifications, []);
  assert.equal(res.error, t('initAiBadJson'));
});

test('analyzeArchitectureWithAi: sin recomendación en N pasos cae al determinista', async () => {
  const { res } = await architect({ proposal: 'algo', maxSteps: 2 }, '{"done":false}');
  assert.equal(res.source, 'fallback');
  assert.equal(res.reasoning, '');
  assert.deepEqual(res.clarifications, []);
  assert.equal(res.error, t('initAiNoRecommendation', 2));
});
