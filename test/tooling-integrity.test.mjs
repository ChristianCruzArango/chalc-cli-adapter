// Spec 029 (hooks, integridad y CI), T1 — las herramientas de `.chalc/` llevan su huella (R7) y el portón se
// niega a medir con herramientas alteradas (R8): quien se mide a sí mismo no puede cambiar la regla sin que se note.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { coherentSpec } from './helpers/coherentspec.mjs';
import { equipForSpec } from '../lib/commands/equip.mjs';
import { runGate } from '../catalog/gate/gate.mjs';
import { INTEGRITY_REL, digestOf, integrityProblems } from '../catalog/gate/lib/integrity.mjs';
import { RULES } from '../catalog/gate/lib/rules.mjs';
import { MESSAGES } from '../catalog/gate/lib/i18n.mjs';

async function equipped(t) {
  const dir = await tempDir(t, 'chalc-029-integrity-');
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts: { test: 'jest' }, devDependencies: { jest: '^29.0.0' } }));
  await equipForSpec(dir, 'lite', 'claude', { specLang: 'es' });
  return dir;
}
const manifest = async (dir) => JSON.parse(await readFile(join(dir, ...INTEGRITY_REL.split('/')), 'utf8'));
const at = (dir, rel) => join(dir, ...rel.split('/'));

test('R7: la huella no depende del fin de línea, y sí del contenido', () => {
  assert.equal(digestOf('a\r\nb\r\n'), digestOf('a\nb\n'));
  assert.notEqual(digestOf('a\nb\n'), digestOf('a\nc\n'));
  assert.match(digestOf(''), /^[0-9a-f]{64}$/);
  assert.equal(digestOf(Buffer.from('a\r\nb')), digestOf('a\nb'));
});

test('R7: equipar escribe el manifiesto con la huella de cada herramienta emitida', async (t) => {
  const dir = await equipped(t);
  const { files } = await manifest(dir);
  for (const rel of ['.chalc/gate.mjs', '.chalc/gate/gate.mjs', '.chalc/gate/lib/integrity.mjs', '.chalc/next.mjs', '.chalc/next/lib/decide.mjs', '.chalc/memory.mjs', '.chalc/live.mjs']) {
    assert.match(files[rel] || '', /^[0-9a-f]{64}$/, rel);
    assert.equal(files[rel], digestOf(await readFile(at(dir, rel))), rel);
  }
});

test('R7: el manifiesto no incluye configuración ni datos del proyecto, ni a sí mismo', async (t) => {
  const { files } = await manifest(await equipped(t));
  for (const rel of ['.chalc/gate.json', INTEGRITY_REL, '.chalc/gate.md', '.chalc/memory/memory.jsonl']) assert.equal(rel in files, false, rel);
  assert.deepEqual(Object.keys(files), [...Object.keys(files)].sort(), 'ordenado, para que su diff sea legible');
});

test('R8: recién equipado no hay problemas de integridad, y re-equipar tampoco los crea', async (t) => {
  const dir = await equipped(t);
  assert.deepEqual(await integrityProblems(dir), []);
  await equipForSpec(dir, 'lite', 'claude', { specLang: 'es' });
  assert.deepEqual(await integrityProblems(dir), []);
});

test('R8: una herramienta alterada, borrada o sin manifiesto se reporta con su archivo y su motivo', async (t) => {
  const dir = await equipped(t);
  await appendFile(at(dir, '.chalc/gate/lib/mutation.mjs'), '\n// umbral rebajado a mano\n');
  await rm(at(dir, '.chalc/next/lib/decide.mjs'));
  assert.deepEqual(await integrityProblems(dir), [
    { file: '.chalc/gate/lib/mutation.mjs', reason: 'altered' },
    { file: '.chalc/next/lib/decide.mjs', reason: 'missing' }
  ]);
  await rm(at(dir, INTEGRITY_REL));
  assert.deepEqual(await integrityProblems(dir), [{ file: INTEGRITY_REL, reason: 'no-manifest' }]);
  await writeFile(at(dir, INTEGRITY_REL), '{ roto');
  assert.deepEqual(await integrityProblems(dir), [{ file: INTEGRITY_REL, reason: 'no-manifest' }]);
});

test('R8: cambiar solo el fin de línea de una herramienta (checkout en Windows) no es una alteración', async (t) => {
  const dir = await equipped(t);
  const file = at(dir, '.chalc/gate/lib/rules.mjs');
  await writeFile(file, (await readFile(file, 'utf8')).replace(/\n/g, '\r\n'));
  assert.deepEqual(await integrityProblems(dir), []);
});

test('R8: un repo sin herramientas emitidas (el portón corre desde otro sitio) no tiene nada que comprobar', async (t) => {
  assert.deepEqual(await integrityProblems(await tempDir(t, 'chalc-029-integrity-')), []);
});

test('R8: con herramientas alteradas el portón se bloquea antes de cualquier otra etapa', async (t) => {
  const dir = await equipped(t);
  for (const [rel, content] of Object.entries(coherentSpec('specs/001-demo'))) {
    await mkdir(dirname(at(dir, rel)), { recursive: true });
    await writeFile(at(dir, rel), content);
  }
  await appendFile(at(dir, '.chalc/gate/lib/smells.mjs'), '\n// regla relajada\n');
  const calls = [];
  const result = await runGate({ root: dir, fast: true, changed: ['src/a.ts'], run: async (c) => { calls.push(c); return { code: 0, ms: 1 }; } });
  assert.deepEqual(result.stages.map((s) => s.stage), ['tooling']);
  assert.equal(result.verdict, 'blocked');
  assert.deepEqual(calls, [], 'no corre ni un test');
  assert.deepEqual(result.stages[0].findings.map((f) => [f.file, f.rule, f.data.reason]), [['.chalc/gate/lib/smells.mjs', RULES.toolingAltered, 'altered']]);
  assert.ok(existsSync(at(dir, '.chalc/gate.md')));
});

test('R8: el motivo dice en es y en qué pasó y que se re-equipe', () => {
  for (const reason of ['altered', 'missing', 'no-manifest']) {
    for (const lang of ['es', 'en']) assert.match(MESSAGES[lang][RULES.toolingAltered]({ reason }, lang), /chalc/, `${reason} ${lang}`);
    assert.notEqual(MESSAGES.es[RULES.toolingAltered]({ reason }, 'es'), MESSAGES.en[RULES.toolingAltered]({ reason }, 'en'));
  }
  assert.notEqual(MESSAGES.es[RULES.toolingAltered]({ reason: 'altered' }, 'es'), MESSAGES.es[RULES.toolingAltered]({ reason: 'missing' }, 'es'));
});
