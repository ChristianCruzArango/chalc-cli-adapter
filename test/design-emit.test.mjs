// Spec 038 (contrato de diseño), T4 — equipar deja el contrato y su evaluador en el repo (R1): corre con Node a
// secas, el contrato no se pisa al re-equipar y las herramientas entran en la integridad.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { equipForSpec } from '../lib/commands/equip.mjs';
import { DESIGN_REL, emitDesign, emitDesignContract } from '../lib/designemit.mjs';
import { DEFAULT_CONTRACT } from '../catalog/design/lib/contract.mjs';
import { integrityProblems } from '../catalog/gate/lib/integrity.mjs';
import { toolingDrift } from '../lib/tooldrift.mjs';

async function equipped(t) {
  const dir = await tempDir(t, 'chalc-038-emit-');
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts: { test: 'jest' }, devDependencies: { jest: '^29.0.0' } }));
  await equipForSpec(dir, 'lite', 'claude', { specLang: 'es' });
  return dir;
}
const json = async (dir, ...rel) => JSON.parse(await readFile(join(dir, ...rel), 'utf8'));
const design = (dir, ...args) => spawnSync(process.execPath, [join('.chalc', 'design.mjs'), ...args], { cwd: dir, encoding: 'utf8', timeout: 60000 });

test('R1: emitDesign deja el lanzador y el árbol de herramientas', async (t) => {
  const { written } = await emitDesign(await tempDir(t, 'chalc-038-emit-'));
  assert.equal(DESIGN_REL, '.chalc/design.mjs');
  for (const rel of ['.chalc/design.mjs', '.chalc/design/design.mjs', '.chalc/design/lib/evaluate.mjs', '.chalc/design/lib/contract.mjs']) assert.ok(written.includes(rel), rel);
});

test('R1: equipar crea el contrato por defecto, y `node .chalc/design.mjs` corre con Node a secas', async (t) => {
  const dir = await equipped(t);
  assert.deepEqual(await json(dir, '.chalc', 'design.contract.json'), JSON.parse(JSON.stringify(DEFAULT_CONTRACT)));
  const shown = design(dir, 'contract');
  assert.equal(shown.status, 0, shown.stdout + shown.stderr);
  assert.equal(JSON.parse(shown.stdout).spacing.minGap, 8);
  await writeFile(join(dir, 'medidas.json'), JSON.stringify({ viewports: [{ name: 'movil', width: 375, height: 812, elements: [
    { selector: '#a', interactive: true, rect: { x: 16, y: 16, width: 100, height: 44 }, fontSize: 16, text: 'a' }, { selector: '#b', interactive: true, rect: { x: 118, y: 16, width: 100, height: 44 }, fontSize: 16, text: 'b' }] }] }));
  const checked = design(dir, 'check', 'medidas.json');
  assert.equal(checked.status, 1);
  assert.match(checked.stdout, /#a.*2 px.*#b/s);
});

test('R1: volver a equipar no pisa el contrato que el usuario ajustó', async (t) => {
  const dir = await equipped(t);
  await writeFile(join(dir, '.chalc', 'design.contract.json'), JSON.stringify({ spacing: { minGap: 12 } }));
  await equipForSpec(dir, 'lite', 'claude', { specLang: 'es' });
  assert.deepEqual(await json(dir, '.chalc', 'design.contract.json'), { spacing: { minGap: 12 } });
});

test('R1: las herramientas de diseño entran en la integridad y en la comparación con el catálogo; el contrato, no', async (t) => {
  const dir = await equipped(t);
  const manifest = await json(dir, '.chalc', 'integrity.json');
  assert.ok('.chalc/design/lib/evaluate.mjs' in manifest.files && '.chalc/design.mjs' in manifest.files);
  assert.equal('.chalc/design.contract.json' in manifest.files, false, 'es configuración del usuario');
  await writeFile(join(dir, '.chalc', 'design.contract.json'), JSON.stringify({ maxPrimary: 2 }));
  assert.deepEqual(await integrityProblems(dir), []);
  await writeFile(join(dir, '.chalc', 'design', 'lib', 'evaluate.mjs'), 'export const evaluate = () => [];\n');
  assert.deepEqual((await integrityProblems(dir)).map((p) => p.file), ['.chalc/design/lib/evaluate.mjs']);
  assert.deepEqual(await toolingDrift(dir), ['.chalc/design/lib/evaluate.mjs']);
});

test('R1: emitDesignContract dice si lo creó, y lo escribe legible y terminado en salto de línea', async (t) => {
  const dir = await tempDir(t, 'chalc-038-emit-');
  assert.equal(await emitDesignContract(dir), true);
  const text = await readFile(join(dir, '.chalc', 'design.contract.json'), 'utf8');
  assert.equal(text, JSON.stringify(DEFAULT_CONTRACT, null, 2) + '\n');
  assert.equal(await emitDesignContract(dir), false, 'ya existía');
  assert.match(await readFile(join(dir, '.chalc', 'design.mjs'), 'utf8').catch(() => ''), /^$/, 'el contrato solo no emite el evaluador');
  await emitDesign(dir);
  assert.match(await readFile(join(dir, '.chalc', 'design.mjs'), 'utf8'), /Contrato de diseño/);
});
