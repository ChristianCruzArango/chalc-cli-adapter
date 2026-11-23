// Spec 031 (estructura), T3 — las carpetas de la arquitectura llegan al portón (R1, R2). `chalc init` las
// escribe en `.chalc/gate.json`; re-equipar conserva las que haya y no inventa ninguna.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { emitGate } from '../lib/gateemit.mjs';
import { equipCreatedProject, equipForSpec } from '../lib/commands/equip.mjs';

const FOLDERS = ['src/core', 'src/features', 'src/shared'];
async function project(t) {
  const dir = await tempDir(t, 'chalc-031-emit-');
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts: { test: 'jest' }, devDependencies: { jest: '^29.0.0' } }));
  return dir;
}
const gateJson = async (dir) => JSON.parse(await readFile(join(dir, '.chalc', 'gate.json'), 'utf8'));

test('R1: emitir el portón con las carpetas de la arquitectura las deja en structure.folders', async (t) => {
  const dir = await project(t);
  await emitGate(dir, { language: 'es', structure: FOLDERS });
  assert.deepEqual((await gateJson(dir)).structure, { folders: FOLDERS, allow: [] });
});

test('R1: equipar un proyecto recién creado pasa sus carpetas al portón', async (t) => {
  const dir = await project(t);
  await equipCreatedProject(dir, { targetName: 'claude', specLang: 'es', structure: FOLDERS });
  assert.deepEqual((await gateJson(dir)).structure.folders, FOLDERS);
});

test('R2: sin carpetas que declarar no se inventa la clave', async (t) => {
  const dir = await project(t);
  await emitGate(dir, { language: 'es' });
  assert.equal('structure' in (await gateJson(dir)), false);
  await equipForSpec(dir, 'lite', 'claude', { specLang: 'es' });
  assert.equal('structure' in (await gateJson(dir)), false);
});

test('R2: re-equipar conserva el structure del proyecto, con lo que el usuario le añadió', async (t) => {
  const dir = await project(t);
  await emitGate(dir, { language: 'es', structure: FOLDERS });
  const config = await gateJson(dir);
  config.structure.allow = ['scripts'];
  config.structure.folders.push('src/admin');
  await writeFile(join(dir, '.chalc', 'gate.json'), JSON.stringify(config));
  await equipForSpec(dir, 'lite', 'claude', { specLang: 'es' });
  assert.deepEqual((await gateJson(dir)).structure, { folders: [...FOLDERS, 'src/admin'], allow: ['scripts'] });
  await emitGate(dir, { language: 'es', structure: ['otra'] });
  assert.deepEqual((await gateJson(dir)).structure.folders, [...FOLDERS, 'src/admin'], 'lo ya escrito en el proyecto gana');
});
