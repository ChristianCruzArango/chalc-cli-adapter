// Spec 027 (arranque limpio), T3 — los temporales de la herramienta de mutación quedan fuera de git (R9). Qué
// rutas son lo dice la tabla de herramientas; no viajan a `gate.json`, que solo lleva lo que el portón usa.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { detectContext } from '../lib/detect.mjs';
import { repoTools, equipForSpec } from '../lib/commands/equip.mjs';

const JEST = { name: 'x', scripts: { test: 'jest' }, devDependencies: { jest: '^29.0.0' } };
async function project(t, { pkg = JEST, gitignore } = {}) {
  const dir = await tempDir(t, 'chalc-027-ignore-');
  if (pkg) await writeFile(join(dir, 'package.json'), JSON.stringify(pkg));
  if (gitignore !== undefined) await writeFile(join(dir, '.gitignore'), gitignore);
  return dir;
}
const ignored = async (dir) => (existsSync(join(dir, '.gitignore')) ? (await readFile(join(dir, '.gitignore'), 'utf8')).split(/\r?\n/).map((l) => l.trim()) : []);
const toolsOf = async (dir) => (await repoTools(dir, await detectContext(dir))).tools;

test('R9: la tabla dice qué rutas temporales deja la herramienta de mutación de un proyecto JS', async (t) => {
  const tools = await toolsOf(await project(t));
  assert.deepEqual(tools.equip.ignore, ['.stryker-tmp/', 'reports/mutation/']);
});

test('R9: lo que es de equipado no viaja al bloque de mutación que va a gate.json', async (t) => {
  const { mutation } = await toolsOf(await project(t));
  for (const key of ['ignore', 'config', 'configFile', 'setup']) assert.equal(key in mutation, false, key);
  assert.equal(mutation.tool, 'stryker');
});

test('R9: sin herramienta de mutación resuelta no hay nada que ignorar', async (t) => {
  const tools = await toolsOf(await project(t, { pkg: { name: 'x', scripts: { test: 'node --test' } } }));
  assert.deepEqual(tools.equip.ignore, []);
});

test('R9: equipar añade esas rutas al .gitignore, una sola vez', async (t) => {
  const dir = await project(t);
  await equipForSpec(dir, 'lite', 'claude', { specLang: 'es' });
  await equipForSpec(dir, 'lite', 'claude', { specLang: 'es' });
  const lines = await ignored(dir);
  for (const entry of ['.stryker-tmp/', 'reports/mutation/']) assert.equal(lines.filter((l) => l === entry).length, 1, entry);
});

test('R9: lo que el usuario ya ignora (también por una carpeta que lo cubre) no se repite', async (t) => {
  const dir = await project(t, { gitignore: 'node_modules/\nreports/\n' });
  await equipForSpec(dir, 'lite', 'claude', { specLang: 'es' });
  const lines = await ignored(dir);
  assert.ok(lines.includes('.stryker-tmp/'));
  assert.equal(lines.includes('reports/mutation/'), false, '`reports/` ya lo cubre');
  assert.ok(lines.includes('node_modules/'), 'lo del usuario sigue ahí');
});

test('R9: un proyecto sin temporales de mutación no recibe esas líneas', async (t) => {
  const dir = await project(t, { pkg: { name: 'x', scripts: { test: 'node --test' } } });
  await equipForSpec(dir, 'lite', 'claude', { specLang: 'es' });
  const lines = await ignored(dir);
  assert.equal(lines.includes('.stryker-tmp/'), false);
});
