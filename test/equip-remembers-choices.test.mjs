// Spec 026 (no-destruir), T2 — equipar para una spec (`spec-ia`, `feature`) conserva lo que el proyecto
// ya eligió: la arquitectura acordada y las skills que no salen de las reglas (R4, R5, R7, R8).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { readChoices } from '../lib/manifest.mjs';
import { equipForSpec, rememberedSkills } from '../lib/commands/equip.mjs';

const ARCHITECTURE = { id: 'modular-feature', name: 'NestJS Modular por Features' };
const EXTRA = 'interface-design';          // existe en el catálogo y ninguna regla de NestJS la aporta
const GONE = 'skill-que-ya-no-existe';

async function project(t, manifest) {
  const dir = await tempDir(t, 'chalc-026-equip-');
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'x', dependencies: { '@nestjs/core': '11' } }));
  if (manifest !== undefined) await writeFile(join(dir, '.chalc.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
  return dir;
}
const manifestOf = async (dir) => JSON.parse(await readFile(join(dir, '.chalc.json'), 'utf8'));

test('readChoices devuelve las skills guardadas y descarta lo que no es un id', async (t) => {
  const dir = await project(t, { skills: ['clean-code', EXTRA, '../fuera', 7, ''] });
  assert.deepEqual((await readChoices(dir)).skills, ['clean-code', EXTRA]);
});

test('readChoices sin skills, con skills que no son lista o sin manifiesto devuelve lista vacía', async (t) => {
  assert.deepEqual((await readChoices(await project(t, { lang: 'es' }))).skills, []);
  assert.deepEqual((await readChoices(await project(t, { skills: 'clean-code' }))).skills, []);
  assert.deepEqual((await readChoices(await project(t))).skills, []);
  assert.deepEqual((await readChoices(await project(t, '{ roto'))).skills, []);
});

test('R5/R7: rememberedSkills une las recordadas que existen y reporta las que ya no', () => {
  const out = rememberedSkills([EXTRA, GONE, 'clean-code'], ['clean-code', 'nestjs']);
  assert.deepEqual(out.skills, ['clean-code', 'nestjs', EXTRA]);
  assert.deepEqual(out.missing, [GONE]);
});

test('R8: rememberedSkills sin nada recordado devuelve exactamente las de las reglas', () => {
  assert.deepEqual(rememberedSkills([], ['clean-code', 'nestjs']), { skills: ['clean-code', 'nestjs'], missing: [] });
});

test('R4/R5: equipForSpec conserva la arquitectura y las skills extra del manifiesto', async (t) => {
  const dir = await project(t, { target: 'claude', lang: 'es', skills: [EXTRA], methods: ['sdd:lite'], architecture: ARCHITECTURE });
  const skills = await equipForSpec(dir, 'lite', 'claude', { specLang: 'es' });
  const manifest = await manifestOf(dir);
  assert.deepEqual(manifest.architecture, ARCHITECTURE);
  assert.ok(manifest.skills.includes(EXTRA), 'la skill extra sigue en el manifiesto');
  assert.ok(skills.includes(EXTRA), 'y en la lista que recibe el hand-off');
  assert.ok(existsSync(join(dir, '.claude', 'skills', EXTRA, 'SKILL.md')), 'y está equipada en el proyecto');
});

test('R7: una skill recordada que ya no existe se omite con aviso y no rompe el equipado', async (t) => {
  const dir = await project(t, { target: 'claude', lang: 'es', skills: [GONE, EXTRA] });
  const warnings = [];
  t.mock.method(console, 'warn', (line) => warnings.push(String(line)));
  const skills = await equipForSpec(dir, 'lite', 'claude', { specLang: 'es' });
  assert.equal(skills.includes(GONE), false);
  assert.equal((await manifestOf(dir)).skills.includes(GONE), false);
  assert.ok(skills.includes(EXTRA));
  assert.ok(warnings.some((line) => line.includes(GONE)), 'avisa nombrando la skill');
});

test('R8: sin manifiesto, equipForSpec equipa lo de las reglas y no inventa arquitectura', async (t) => {
  const dir = await project(t);
  const skills = await equipForSpec(dir, 'lite', 'claude', { specLang: 'es' });
  const manifest = await manifestOf(dir);
  assert.equal('architecture' in manifest, false);
  assert.equal(skills.includes(EXTRA), false);
  assert.deepEqual(manifest.skills, skills);
});
