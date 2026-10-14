// T12 (spec 022, R18, F6) — un fallo a mitad de `chalc feature` no pierde lo ya pagado: el orquestador
// entrega lo terminado (`partial` / `partialStories`) y el comando sabe qué lados puede escribir.

import test from 'node:test';
import assert from 'node:assert/strict';
import { orchestrateFeatures } from '../lib/featureorch.mjs';
import { completedSides, featureSlug } from '../lib/commands/featureshared.mjs';
import { SIDE } from '../lib/sides.mjs';

const okSpec = (name) => ({ feature: name, files: { 'spec.md': `# ${name}` }, validation: [] });
const sides = { back: { stack: 'NestJS' }, front: { stack: 'Angular' } };

test('F6: orchestrateFeatures entrega las HUs terminadas cuando una posterior falla', async () => {
  let calls = 0;
  const err = await orchestrateFeatures({
    cfg: {}, userStories: ['HU uno', 'HU dos'], ...sides,
    generateContractImpl: async () => ({ contract: 'C', trace: {} }),
    generateSpecImpl: async () => { if (++calls === 3) throw Object.assign(new Error('429'), { status: 429 }); return okSpec('x'); }
  }).catch((e) => e);
  assert.equal(err.message, '429');
  assert.equal(err.partialStories.length, 1);
  assert.equal(err.partialStories[0].userStory, 'HU uno');
  assert.ok(err.partialStories[0].back && err.partialStories[0].front);
});

test('F6: completedSides deja solo los lados con spec generada', () => {
  const all = [[SIDE.FRONT, '/f'], [SIDE.BACK, '/b'], [SIDE.MOBILE, '/m']];
  const partial = { back: okSpec('b'), front: null, mobile: null };
  assert.deepEqual(completedSides(partial, all), [[SIDE.BACK, '/b']]);
  assert.deepEqual(completedSides({ back: null, front: null, mobile: null }, all), []);
  assert.deepEqual(completedSides({ back: okSpec('b'), front: okSpec('f'), mobile: okSpec('m') }, all), all);
});

test('F6: featureSlug no falla si el front no llegó a generarse', () => {
  assert.equal(featureSlug({ back: okSpec('Alta Usuario'), front: null }), 'alta-usuario');
  assert.equal(featureSlug({ back: okSpec('B'), front: okSpec('Front Name') }), 'front-name');
  assert.equal(featureSlug({ back: null, front: null }), 'feature');
});
