// T10 (spec 022, R18, F6) — mutantes: escritura parcial de `chalc feature` (savePartialSpecs,
// writeFeatureSpecs), HUs terminadas en modo worktree (generateStories), slug de la feature y el
// idioma por defecto del hand-off. Sin IA: los generadores se inyectan.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { savePartialSpecs, writeFeatureSpecs } from '../lib/commands/feature.mjs';
import { generateStories } from '../lib/commands/featureworktree.mjs';
import { featureSlug, sideLabel } from '../lib/commands/featureshared.mjs';
import { HANDOFF_WORDS, handoffCommand } from '../lib/commands/specgen.mjs';
import { c } from '../lib/commands/context.mjs';
import { lang, t } from '../lib/i18n.mjs';
import { SIDE } from '../lib/sides.mjs';
import { tempDir } from './helpers/tmpdir.mjs';

const cfg = { provider: 'openai', model: 'm' };
const spec = (feature, body) => ({ feature, files: { 'spec.md': body }, trace: { system: 's', user: 'u', raw: 'r' } });

// Captura lo que el comando imprime (console.log) durante `fn`.
async function captureLog(tc, fn) {
  const lines = [];
  tc.mock.method(console, 'log', (...args) => { lines.push(args.join(' ')); });
  try { return { value: await fn(), lines }; } finally { tc.mock.restoreAll(); }
}

const specDirs = (repo) => (existsSync(join(repo, 'specs')) ? readdirSync(join(repo, 'specs')) : []);

test('writeFeatureSpecs escribe el back primero y cada lado una sola vez', async (tc) => {
  const back = await tempDir(tc);
  const front = await tempDir(tc);
  const result = { contract: 'CONTRACT', back: spec('Alta', '# back'), front: spec('Alta', '# front') };
  const { value: outs, lines } = await captureLog(tc, () =>
    writeFeatureSpecs(result, [[SIDE.FRONT, front], [SIDE.BACK, back]], { cfg, slug: 'alta' }));
  assert.deepEqual(Object.keys(outs).sort(), [SIDE.BACK, SIDE.FRONT]);
  const expected = [
    '\n' + c.green('✓ ' + t('featSpecWritten', sideLabel(SIDE.BACK), outs[SIDE.BACK].rel)),
    c.green('✓ ' + t('featSpecWritten', sideLabel(SIDE.FRONT), outs[SIDE.FRONT].rel))
  ];
  assert.deepEqual(lines.filter((l) => expected.includes(l)), expected);
  assert.ok(!lines.some((l) => l.includes(t('featReusingFolder', sideLabel(SIDE.FRONT), outs[SIDE.FRONT].id))));
  assert.equal(readFileSync(join(back, outs[SIDE.BACK].rel, 'spec.md'), 'utf8').includes('# back'), true);
  assert.equal(readFileSync(join(front, outs[SIDE.FRONT].rel, 'spec.md'), 'utf8').includes('# front'), true);
});

test('savePartialSpecs no escribe nada si el error no trae resultado parcial', async (tc) => {
  const back = await tempDir(tc);
  const { lines } = await captureLog(tc, () => savePartialSpecs(new Error('429'), [[SIDE.BACK, back]], cfg));
  assert.deepEqual(lines, []);
  assert.deepEqual(specDirs(back), []);
});

test('savePartialSpecs no escribe nada si ningún lado terminó', async (tc) => {
  const back = await tempDir(tc);
  const err = Object.assign(new Error('429'), { partial: { contract: 'C', back: null, front: null, mobile: null } });
  const { lines } = await captureLog(tc, () => savePartialSpecs(err, [[SIDE.BACK, back]], cfg));
  assert.deepEqual(lines, []);
  assert.deepEqual(specDirs(back), []);
});

test('savePartialSpecs escribe solo los lados terminados y lo avisa', async (tc) => {
  const back = await tempDir(tc);
  const front = await tempDir(tc);
  const err = Object.assign(new Error('429'), { partial: { contract: 'C', back: spec('Alta Usuario', '# b'), front: null, mobile: null } });
  const { lines } = await captureLog(tc, () => savePartialSpecs(err, [[SIDE.BACK, back], [SIDE.FRONT, front]], cfg));
  assert.equal(lines.at(-1), '  ' + c.yellow('!') + ' ' + t('featPartialSaved', sideLabel(SIDE.BACK)));
  assert.equal(specDirs(back).filter((d) => d.endsWith('alta-usuario')).length, 1);
  assert.deepEqual(specDirs(front), []);
});

test('savePartialSpecs nombra todos los lados guardados, separados por coma', async (tc) => {
  const back = await tempDir(tc);
  const front = await tempDir(tc);
  const err = Object.assign(new Error('x'), { partial: { contract: 'C', back: spec('F', '# b'), front: spec('F', '# f'), mobile: null } });
  const { lines } = await captureLog(tc, () => savePartialSpecs(err, [[SIDE.BACK, back], [SIDE.FRONT, front]], cfg));
  assert.equal(lines.at(-1), '  ' + c.yellow('!') + ' ' + t('featPartialSaved', `${sideLabel(SIDE.BACK)}, ${sideLabel(SIDE.FRONT)}`));
});

// Generadores falsos para orchestrateFeatures: la llamada número `failAt` lanza un 429.
function fakes(failAt = 0) {
  let calls = 0;
  return {
    back: { stack: 'NestJS' }, front: { stack: 'Angular' },
    generateContractImpl: async () => ({ contract: 'C', trace: {} }),
    generateSpecImpl: async () => {
      if (++calls === failAt) throw Object.assign(new Error('429'), { status: 429 });
      return spec('x', '# x');
    }
  };
}

test('generateStories devuelve todas las HUs y sin fallo cuando todo va bien', async (tc) => {
  const { value, lines } = await captureLog(tc, () => generateStories({ cfg, userStories: ['a', 'b'], ...fakes() }, true));
  if (!process.stdout.isTTY) assert.equal(lines[0], c.dim('  ' + t('featOrchestrating', true)));
  assert.equal(value.failure, null);
  assert.deepEqual(value.results.map((r) => r.userStory), ['a', 'b']);
});

test('generateStories conserva las HUs terminadas y entrega el fallo para el final', async (tc) => {
  const { value, lines } = await captureLog(tc, () => generateStories({ cfg, userStories: ['a', 'b'], ...fakes(3) }, false));
  assert.equal(value.failure.message, '429');
  assert.deepEqual(value.results.map((r) => r.userStory), ['a']);
  assert.equal(lines.at(-1), '  ' + c.yellow('!') + ' ' + t('featPartialStories', 1, 2));
});

test('generateStories relanza el error si ninguna HU terminó', async (tc) => {
  await captureLog(tc, () => assert.rejects(generateStories({ cfg, userStories: ['a'], ...fakes(1) }, false), /^Error: 429$/));
});

test('generateStories relanza tal cual un error sin HUs parciales', async (tc) => {
  await captureLog(tc, () => assert.rejects(generateStories({ cfg, userStories: [], ...fakes() }, false), { message: t('featNoStories') }));
});

test('featureSlug cae a "feature" si el nombre propuesto no deja slug', () => {
  assert.equal(featureSlug({ back: { feature: '¡¡!!' }, front: null }), 'feature');
  assert.equal(featureSlug({ back: { feature: 'Back Name' }, front: { feature: '' } }), 'back-name');
});

test('handoffCommand sin idioma de spec usa el idioma de la interfaz', () => {
  const words = HANDOFF_WORDS[lang === 'es' ? 'es' : 'en'];
  assert.ok(handoffCommand('specs/001-x').includes(words.skillsLine));
});
