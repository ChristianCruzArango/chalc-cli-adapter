import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeArchitectureWithAi, chunkProposal, sanitizeClarifications } from '../lib/initai.mjs';

const cfg = { provider: 'openai', model: 'test', models: { qa: 'cheap' } };
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('sanitizeClarifications drops the reasoning tail, empties and dupes, and caps at 2', () => {
  const out = sanitizeClarifications([
    '¿Cuántos usuarios concurrentes se esperan? Esto podría elevar la necesidad de ceremony.',
    '¿Hay reglas de negocio complejas como SLAs y escalaciones?',
    '   ',
    '¿Hay reglas de negocio complejas como SLAs y escalaciones?',   // duplicado
    '¿Una tercera pregunta que debe quedar fuera?'
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0], '¿Cuántos usuarios concurrentes se esperan?');   // sin el razonamiento pegado
  assert.ok(!out[0].includes('ceremony'));
  assert.deepEqual(sanitizeClarifications('no es array'), []);
});

test('chunkProposal splits the proposal into sections by blank lines', () => {
  assert.deepEqual(chunkProposal('Objetivo del sistema.\n\nReglas de negocio.\n\nIntegraciones.'),
    ['Objetivo del sistema.', 'Reglas de negocio.', 'Integraciones.']);
  assert.deepEqual(chunkProposal('una sola sección'), ['una sola sección']);
});

test('analyzeArchitectureWithAi returns the model recommendation when it is a valid stack architecture', async () => {
  const chatImpl = async () => '{"done":true,"architectureId":"modular-feature-first","reasoning":"alcance simple","clarifications":["¿auth?"]}';
  const res = await analyzeArchitectureWithAi({ cfg, stackId: 'angular', proposal: 'tool interno simple para listar registros', chatImpl });
  assert.equal(res.architectureId, 'modular-feature-first');
  assert.equal(res.source, 'ai');
  assert.equal(res.reasoning, 'alcance simple');
  assert.deepEqual(res.clarifications, ['¿auth?']);
});

test('analyzeArchitectureWithAi NEVER accepts an invented architecture: falls back to the deterministic pick', async () => {
  const chatImpl = async () => '{"done":true,"architectureId":"super-mega-arquitectura","reasoning":"x"}';
  const res = await analyzeArchitectureWithAi({ cfg, stackId: 'angular', proposal: 'reglas de negocio y dominio complejo', chatImpl });
  // dominio → determinista recomienda clean architecture; el id inventado se descarta
  assert.equal(res.architectureId, 'modular-clean-architecture');
  assert.equal(res.invalidId, 'super-mega-arquitectura');
});

test('analyzeArchitectureWithAi compacts a big proposal with CCR and serves recall (token saving)', async () => {
  const big = 'Detalle extenso de la propuesta. '.repeat(40);   // > umbral CCR
  const seenSystems = [];
  let turn = 0;
  const scripted = ['{"recall":"c1"}', '{"done":true,"architectureId":"modular-feature-first","reasoning":"ok","clarifications":[]}'];
  const chatImpl = async (_cfg, { system }) => { seenSystems.push(system); return scripted[turn++]; };

  const res = await analyzeArchitectureWithAi({ cfg, stackId: 'angular', proposal: big, chatImpl, maxSteps: 4 });
  assert.equal(res.architectureId, 'modular-feature-first');
  assert.ok(res.ccr.entries >= 1);                              // la sección grande se difirió
  assert.match(seenSystems[0], /\[CCR ref=c1/);                 // viajó comprimida en el 1er turno
  assert.ok(!seenSystems[0].includes(big));                     // el texto completo NO estaba inline
  assert.ok(seenSystems[1].includes(big.trim()));               // tras recall, el 2º turno la muestra completa
});

test('analyzeArchitectureWithAi can be run without CCR (ccr:false)', async () => {
  const chatImpl = async () => '{"done":true,"architectureId":"enterprise-modular","reasoning":"equipos grandes"}';
  const res = await analyzeArchitectureWithAi({ cfg, stackId: 'angular', proposal: 'plataforma enterprise con múltiples equipos', chatImpl, ccr: false });
  assert.equal(res.architectureId, 'enterprise-modular');
  assert.equal(res.ccr, null);
});

test('init architect prompt frames AI as adviser, not authority', async () => {
  const prompt = await readFile(resolve(ROOT, 'lib/prompts/init-architect.prompt.xml'), 'utf8');
  assert.match(prompt, /ALLY, not an oracle/);
  assert.match(prompt, /NOT an authority/);
  assert.match(prompt, /tradeoff/);
  assert.match(prompt, /human decides|user/i);
});
