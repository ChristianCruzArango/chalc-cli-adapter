// Spec 027 (arranque limpio), T4 — `chalc init` muestra el paso de mutación (R5, R7, R8): en seco como una línea
// más del plan; al crear, con lo que pasó. Los comandos no se ejecutan de verdad: el paso se inyecta.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { printInitMutation } from '../lib/commands/mutationstep.mjs';

const plain = (line) => line.replace(/\x1b\[[0-9;]*m/g, '');
async function project(t) {
  const dir = await tempDir(t, 'chalc-027-init-');
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts: { test: 'jest' }, devDependencies: { jest: '^29.0.0' } }));
  return dir;
}
const collect = async (dir, opts) => {
  const lines = [];
  await printInitMutation(dir, opts, (line) => lines.push(plain(line)));
  return lines;
};

test('R8: en dry-run es una línea del plan y no mira ni toca el proyecto', async (t) => {
  const missing = join(await tempDir(t, 'chalc-027-init-'), 'todavia-no-existe');
  const lines = await collect(missing, { want: true, dryRun: true, runStep: async () => { throw new Error('no debe ejecutarse'); } });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^ {2}▶ /);
  assert.equal(existsSync(missing), false);
  assert.deepEqual(await collect(missing, { want: null, dryRun: true }), []);
});

test('R5, R6: al crear, instala con el paso del init y deja la configuración; lo cuenta con viñetas', async (t) => {
  const dir = await project(t);
  const steps = [];
  const lines = await collect(dir, { want: true, dryRun: false, runStep: async (step) => { steps.push(step); return { code: 0 }; } });
  assert.equal(steps.length, 1);
  assert.equal(steps[0].cwd, 'project');
  assert.equal(lines.length, 2);
  for (const line of lines) assert.match(line, /^ {2}• /);
  assert.equal(JSON.parse(await readFile(join(dir, 'stryker.conf.json'), 'utf8')).testRunner, 'jest');
});

test('R7: un fallo de instalación se cuenta y no lanza', async (t) => {
  const dir = await project(t);
  const lines = await collect(dir, { want: true, dryRun: false, runStep: async () => ({ code: 1 }) });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /npm i -D/);
});

test('R8: con --no-mutation no imprime nada', async (t) => {
  assert.deepEqual(await collect(await project(t), { want: false, dryRun: false, runStep: async () => ({ code: 0 }) }), []);
});
