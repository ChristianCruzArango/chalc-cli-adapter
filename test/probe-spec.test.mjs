// Spec 041 (superficies sin interfaz), T3 — las sondas son parte de la spec (R6): una spec de API o de CLI las
// necesita, tienen que valer, y lo que el usuario sella las incluye: quien desarrolla no las afloja.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { appendFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { writeFiles } from './helpers/teamrepo.mjs';
import { coherentSpec, coherentTexts } from './helpers/coherentspec.mjs';
import { probesProblems } from '../catalog/gate/lib/designspec.mjs';
import { coherenceProblems } from '../catalog/gate/lib/coherence.mjs';
import { specFingerprint } from '../catalog/gate/lib/specprint.mjs';
import { specFacts } from '../catalog/gate/lib/specfacts.mjs';
import { messageOf } from '../catalog/gate/lib/i18n.mjs';
import { RULES } from '../catalog/gate/lib/rules.mjs';
import { parseProbes } from '../catalog/probe/lib/probes.mjs';

const DIR = 'specs/001-demo';
const withSurface = (surface) => ({ ...coherentTexts(), 'plan.md': `# Plan\n\nCubre R1.\n\nSuperficie: ${surface}\n` });
const PROBES = JSON.stringify({ api: [{ name: 'salud', url: 'http://localhost:3000/salud', expect: { status: 200 } }] });
const SDD = new URL('../catalog/methods/sdd/', import.meta.url);

test('R6: con superficie api o cli y sin probes.json, es una incoherencia; con interfaz sola, o sin superficie, no', () => {
  for (const surface of ['api', 'cli', 'ui, api']) assert.deepEqual(probesProblems(DIR, withSurface(surface)), [{ file: `${DIR}/probes.json`, line: 1, rule: RULES.probesMissing, data: {} }], surface);
  assert.deepEqual(probesProblems(DIR, { ...withSurface('api'), 'probes.json': PROBES }), []);
  assert.deepEqual(probesProblems(DIR, withSurface('ui')), []);
  assert.deepEqual(probesProblems(DIR, coherentTexts()), []);
});

test('R6: un probes.json que no vale también se reporta, con su porqué', () => {
  assert.deepEqual(probesProblems(DIR, { ...withSurface('api'), 'probes.json': '{ roto' }), [{ file: `${DIR}/probes.json`, line: 1, rule: RULES.probesInvalid, data: { problem: 'not-json' } }]);
  assert.deepEqual(probesProblems(DIR, { ...coherentTexts(), 'probes.json': '{}' })[0].data, { problem: 'empty' }, 'aunque el plan no declare superficie');
});

test('R6: el portón lo reporta, y lo explica en los dos idiomas', () => {
  const problems = coherenceProblems({ dir: DIR, problem: '', files: withSurface('cli'), seal: null });
  assert.deepEqual(problems.map((p) => p.rule), [RULES.probesMissing]);
  for (const lang of ['es', 'en']) {
    assert.ok(messageOf(RULES.probesMissing, {}, lang).includes('probes.json'));
    assert.ok(messageOf(RULES.probesInvalid, { problem: 'not-json' }, lang).includes('not-json'));
  }
});

test('R6: las sondas se sellan con la spec: cambiarlas tras aprobar invalida la aprobación', async (t) => {
  const texts = coherentTexts();
  const before = specFingerprint(texts);
  assert.equal(specFingerprint({ ...texts, 'probes.json': null }), before);
  const sealed = specFingerprint({ ...texts, 'probes.json': PROBES });
  assert.notEqual(sealed, before);
  assert.notEqual(specFingerprint({ ...texts, 'probes.json': PROBES.replace('200', '500') }), sealed);
  assert.notEqual(specFingerprint({ ...texts, 'design.md': PROBES }), sealed, 'no es lo mismo que el diseño');
  const root = await tempDir(t, 'chalc-041-spec-');
  const withProbes = { ...withSurface('api'), 'probes.json': PROBES };
  await writeFiles(root, { ...coherentSpec(DIR, { texts: withProbes }), [`${DIR}/probes.json`]: PROBES });
  assert.deepEqual([(await specFacts(root, 'specs')).approved, (await specFacts(root, 'specs')).problems], [true, []]);
  await appendFile(join(root, ...DIR.split('/'), 'probes.json'), '\n');
  assert.equal((await specFacts(root, 'specs')).approved, true, 'un salto de línea al final no es un cambio');
  await writeFiles(root, { [`${DIR}/probes.json`]: PROBES.replace('200', '500') });
  assert.equal((await specFacts(root, 'specs')).approved, false);
});

for (const scaffold of ['scaffold-lite', 'scaffold-lite-en', 'scaffold-full', 'scaffold-full-en']) {
  test(`R6 (${scaffold}): la plantilla trae un probes.json de ejemplo que se puede leer`, async () => {
    const file = new URL(`${scaffold}/specs/_template/probes.json`, SDD);
    assert.ok(existsSync(file));
    const probes = parseProbes(await readFile(file, 'utf8'));
    assert.deepEqual([probes.problem, probes.api.length, probes.cli.length], ['', 1, 1]);
  });
}

for (const rules of ['rules-lite.md', 'rules-full.md', 'rules-lite.en.md', 'rules-full.en.md']) {
  test(`R6 (${rules}): las reglas del método piden las sondas para api y cli`, async () => {
    assert.ok((await readFile(new URL(rules, SDD), 'utf8')).includes('probes.json'));
  });
}
