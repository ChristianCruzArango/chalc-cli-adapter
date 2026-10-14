// T5 (spec 022, R19, C2/C3) — lo que ve el usuario sale por t() (C2) y lo que se le dice al modelo
// va en inglés, el idioma de los prompts (C3). Sin red ni tokens.

import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { t } from '../lib/i18n.mjs';
import { analyzeArchitectureWithAi } from '../lib/initai.mjs';
import { aggregateTokenLog } from '../lib/tokenreport.mjs';
import { git } from '../lib/gitprep.mjs';
import { authNote } from '../lib/commands/qaagentrun.mjs';

const cfg = { provider: 'openai' };

// T5 (spec 022, R19, C2)
test('T5 R19 C2: initai fallback errors are translated', async () => {
  const bad = await analyzeArchitectureWithAi({ cfg, stackId: 'angular', proposal: 'x', chatImpl: async () => 'no json', ccr: false });
  assert.equal(bad.error, t('initAiBadJson'));
  const stuck = await analyzeArchitectureWithAi({ cfg, stackId: 'angular', proposal: 'x', chatImpl: async () => '{"recall":"zz"}', maxSteps: 1 });
  assert.equal(stuck.error, t('initAiNoRecommendation', 1));
});

// T5 (spec 022, R19, C2)
test('T5 R19 C2: token report placeholders for missing command/model are translated', () => {
  const agg = aggregateTokenLog([{ input: 1, output: 1 }]);
  assert.deepEqual(Object.keys(agg.byCommand), [t('tokNoCommand')]);
  assert.deepEqual(Object.keys(agg.byModel), [t('tokUnknownModel')]);
  assert.notEqual(t('tokNoCommand'), 'tokNoCommand');
  assert.notEqual(t('tokUnknownModel'), 'tokUnknownModel');
});

// T5 (spec 022, R19, C2)
test('T5 R19 C2: git runner errors are translated (git missing, timeout)', async () => {
  const saved = process.env.PATH;
  process.env.PATH = '';
  try {
    const r = await git(['--version'], tmpdir());
    assert.equal(r.err, t('gitUnavailable'));
  } finally { process.env.PATH = saved; }
  const slow = await git(['--version'], tmpdir(), { timeoutMs: 1 });
  if (slow.code !== 0) assert.match(slow.err, new RegExp(t('gitTimedOut').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.notEqual(t('gitTimedOut'), 'gitTimedOut');
});

// T5 (spec 022, R19, C3)
test('T5 R19 C3: the QA auth note told to the model is in English', () => {
  const note = authNote({ headers: { authorization: 'x' } });
  assert.match(note, /QA NOTE/);
  assert.match(note, /Authorization header/);
  assert.doesNotMatch(note, /NOTA|NO construyas|sesión/);
  assert.match(authNote({ storage: {} }), /storage/);
});
