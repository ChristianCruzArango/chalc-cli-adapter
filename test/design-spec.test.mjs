// Spec 038 (contrato de diseño), T5 — el diseño forma parte de la spec (R6, R7): el plan declara su superficie,
// una spec con interfaz necesita su `design.md`, y lo que el usuario sella al aprobar lo incluye.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { appendFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { writeFiles } from './helpers/teamrepo.mjs';
import { coherentSpec, coherentTexts, sealFor } from './helpers/coherentspec.mjs';
import { designProblems, surfaceOf } from '../catalog/gate/lib/designspec.mjs';
import { coherenceProblems } from '../catalog/gate/lib/coherence.mjs';
import { specFingerprint } from '../catalog/gate/lib/specprint.mjs';
import { readSpecSet } from '../catalog/gate/lib/specset.mjs';
import { specFacts } from '../catalog/gate/lib/specfacts.mjs';
import { messageOf } from '../catalog/gate/lib/i18n.mjs';
import { RULES } from '../catalog/gate/lib/rules.mjs';
import { specApproved } from '../catalog/team/lib/specstate.mjs';

const DIR = 'specs/001-demo';
const withSurface = (surface) => ({ ...coherentTexts(), 'plan.md': `# Plan\n\nCubre R1.\n\nSuperficie: ${surface}\n` });
const DESIGN = '# Diseño\n\n## Pantalla: pago\n- Primario: «Pagar»\n';
const SDD = new URL('../catalog/methods/sdd/', import.meta.url);
const SCAFFOLDS = ['scaffold-lite', 'scaffold-lite-en', 'scaffold-full', 'scaffold-full-en'];

test('R6: la superficie se lee del plan, en los dos idiomas; sin declararla o con el hueco de la plantilla, ninguna', () => {
  assert.deepEqual(surfaceOf('# Plan\n\nSuperficie: ui\n'), ['ui']);
  assert.deepEqual(surfaceOf('**Surface:** UI, api\n'), ['ui', 'api']);
  assert.deepEqual(surfaceOf('- Superficie: cli\n'), ['cli']);
  for (const none of ['# Plan\n', 'Superficie: ninguna\n', 'Surface: none\n', 'Superficie: <ui | api | cli | ninguna>\n', 'Superficie: web\n', null, 'La superficie: ui no cuenta a mitad de frase\n']) assert.deepEqual(surfaceOf(none), [], String(none));
});

test('R7: con superficie ui y sin design.md, es una incoherencia de la spec; con él, o sin interfaz, no', () => {
  const missing = designProblems(DIR, withSurface('ui'));
  assert.deepEqual(missing, [{ file: `${DIR}/design.md`, line: 1, rule: RULES.designMissing, data: {} }]);
  assert.deepEqual(designProblems(DIR, { ...withSurface('ui'), 'design.md': '   \n' }).length, 1, 'vacío es como si no estuviera');
  assert.deepEqual(designProblems(DIR, { ...withSurface('ui'), 'design.md': DESIGN }), []);
  assert.deepEqual(designProblems(DIR, withSurface('api')), []);
  assert.deepEqual(designProblems(DIR, coherentTexts()), []);
});

test('R7: el portón lo reporta junto a las demás incoherencias, y lo explica en los dos idiomas', () => {
  const texts = withSurface('ui');
  const problems = coherenceProblems({ dir: DIR, problem: '', files: texts, seal: sealFor(DIR, texts) });
  assert.deepEqual(problems.map((p) => p.rule), [RULES.designMissing]);
  assert.deepEqual(coherenceProblems({ dir: DIR, problem: '', files: { ...texts, 'design.md': DESIGN }, seal: null }), []);
  for (const lang of ['es', 'en']) {
    const text = messageOf(RULES.designMissing, {}, lang);
    assert.ok(text.includes('design.md') && text !== RULES.designMissing, text);
  }
});

test('R7: la huella de una spec sin design.md no cambia; con él, lo incluye', () => {
  const texts = coherentTexts();
  const before = specFingerprint(texts);
  assert.equal(specFingerprint({ ...texts, 'design.md': null }), before);
  assert.equal(specFingerprint({ ...texts, 'design.md': '' }), before);
  const withDesign = specFingerprint({ ...texts, 'design.md': DESIGN });
  assert.notEqual(withDesign, before);
  assert.equal(specFingerprint({ ...texts, 'design.md': DESIGN.replace(/\n/g, '\r\n') }), withDesign, 'los saltos de línea de Windows no cambian nada');
  assert.notEqual(specFingerprint({ ...texts, 'design.md': DESIGN.replace('Pagar', 'Comprar') }), withDesign);
});

test('R7: design.md se lee con la spec, no es obligatorio, y editarlo tras aprobar invalida el sello', async (t) => {
  const root = await tempDir(t, 'chalc-038-spec-');
  const texts = { ...withSurface('ui'), 'design.md': DESIGN };
  await writeFiles(root, { ...coherentSpec(DIR, { texts }), [`${DIR}/design.md`]: DESIGN });
  assert.equal((await readSpecSet(root, 'specs')).files['design.md'], DESIGN);
  const facts = await specFacts(root, 'specs');
  assert.deepEqual([facts.approved, facts.problems], [true, []]);
  assert.equal(await specApproved(root, DIR), true);
  await appendFile(join(root, ...DIR.split('/'), 'design.md'), '- otro botón primario\n');
  assert.equal((await specFacts(root, 'specs')).approved, false);
  assert.equal(await specApproved(root, DIR), false, 'el equipo lo ve igual que el portón');
  const plain = await tempDir(t, 'chalc-038-spec-');
  await writeFiles(plain, coherentSpec(DIR));
  const none = await specFacts(plain, 'specs');
  assert.deepEqual([none.files['design.md'], none.approved, none.problems], [null, true, []]);
});

for (const scaffold of SCAFFOLDS) {
  test(`R6 (${scaffold}): el plan pide la superficie y la plantilla trae design.md`, async () => {
    const en = scaffold.endsWith('-en');
    const plan = await readFile(new URL(`${scaffold}/specs/_template/plan.md`, SDD), 'utf8');
    assert.match(plan, en ? /^Surface: </m : /^Superficie: </m);
    assert.deepEqual(surfaceOf(plan), []);
    assert.ok(existsSync(new URL(`${scaffold}/specs/_template/design.md`, SDD)));
    const design = await readFile(new URL(`${scaffold}/specs/_template/design.md`, SDD), 'utf8');
    for (const piece of [en ? 'Primary' : 'Primario', '.chalc/design.contract.json', en ? 'States' : 'Estados']) assert.ok(design.includes(piece), piece);
  });
}

for (const rules of ['rules-lite.md', 'rules-full.md', 'rules-lite.en.md', 'rules-full.en.md']) {
  test(`R6 (${rules}): las reglas del método piden la superficie y el diseño`, async () => {
    const text = await readFile(new URL(rules, SDD), 'utf8');
    assert.ok(text.includes(rules.endsWith('.en.md') ? '`Surface:`' : '`Superficie:`'));
    assert.ok(text.includes('design.md'));
  });
}
