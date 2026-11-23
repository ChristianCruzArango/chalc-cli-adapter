// Spec 029 (hooks, integridad y CI), T2 — `chalc verify` compara las herramientas de `.chalc/` con las del
// catálogo de chalc instalado (R9). El manifiesto vive en el repo y se puede alterar junto con la herramienta;
// el catálogo está fuera del repo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { equipForSpec } from '../lib/commands/equip.mjs';
import { verifyProject } from '../lib/verify.mjs';
import { toolingDrift } from '../lib/tooldrift.mjs';
import { emitIntegrity } from '../lib/integrityemit.mjs';
import { integrityProblems } from '../catalog/gate/lib/integrity.mjs';
import { DICT } from '../lib/i18n.mjs';

async function equipped(t) {
  const dir = await tempDir(t, 'chalc-029-verify-');
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts: { test: 'jest' }, devDependencies: { jest: '^29.0.0' } }));
  await equipForSpec(dir, 'lite', 'claude', { specLang: 'es' });
  return dir;
}
const toolingCheck = async (dir) => (await verifyProject(dir)).checks.find((c) => c.key === 'tooling');

test('R9: recién equipado, las herramientas son las del catálogo', async (t) => {
  const dir = await equipped(t);
  assert.deepEqual(await toolingDrift(dir), []);
  assert.deepEqual(await toolingCheck(dir), { key: 'tooling', ok: true, items: [] });
});

test('R9: una herramienta alterada se detecta aunque también se haya rehecho su manifiesto', async (t) => {
  const dir = await equipped(t);
  const rel = '.chalc/gate/lib/mutation.mjs';
  await appendFile(join(dir, ...rel.split('/')), '\n// umbral rebajado\n');
  const manifest = JSON.parse(await readFile(join(dir, '.chalc', 'integrity.json'), 'utf8'));
  await emitIntegrity(dir, Object.keys(manifest.files));
  assert.deepEqual(await integrityProblems(dir), [], 'el manifiesto rehecho ya no lo delata');
  assert.deepEqual(await toolingDrift(dir), [rel]);
  const check = await toolingCheck(dir);
  assert.deepEqual([check.ok, check.items], [false, [rel]]);
  assert.equal((await verifyProject(dir)).ok, false);
});

test('R9: una herramienta que falta también se reporta; el fin de línea no cuenta', async (t) => {
  const dir = await equipped(t);
  await rm(join(dir, '.chalc', 'next', 'lib', 'decide.mjs'));
  const rules = join(dir, '.chalc', 'gate', 'lib', 'rules.mjs');
  await writeFile(rules, (await readFile(rules, 'utf8')).replace(/\n/g, '\r\n'));
  assert.deepEqual(await toolingDrift(dir), ['.chalc/next/lib/decide.mjs']);
});

test('R9: la configuración y los datos del proyecto no son herramientas', async (t) => {
  const dir = await equipped(t);
  await writeFile(join(dir, '.chalc', 'gate.json'), '{"mutation":{"threshold":90}}');
  await writeFile(join(dir, '.chalc', 'memory', 'memory.jsonl'), '{"id":"x"}\n');
  assert.deepEqual(await toolingDrift(dir), []);
});

test('R9: un proyecto sin herramientas de chalc no lleva ese chequeo', async (t) => {
  const dir = await tempDir(t, 'chalc-029-verify-');
  assert.equal(await toolingCheck(dir), undefined);
});

test('R9: el chequeo tiene su etiqueta en es y en', () => {
  for (const lang of ['es', 'en']) assert.ok(DICT[lang].vChkTooling, lang);
});
