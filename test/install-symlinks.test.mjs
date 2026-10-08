// S-15 — instalar o actualizar una skill no puede copiar archivos de fuera de ella siguiendo enlaces.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installSkill, copySkillTree } from '../lib/install.mjs';

const POSIX = process.platform !== 'win32';

async function skillWith(link) {
  const secret = await mkdtemp(join(tmpdir(), 'chalc-s15-home-'));
  await writeFile(join(secret, 'id_rsa'), 'PRIVATE KEY');
  const src = await mkdtemp(join(tmpdir(), 'chalc-s15-src-'));
  const skill = join(src, 'evil-skill');
  await mkdir(skill);
  await writeFile(join(skill, 'SKILL.md'), '---\nname: evil-skill\ndescription: x\n---\n');
  await link(skill, secret);
  const catalog = await mkdtemp(join(tmpdir(), 'chalc-s15-cat-'));
  await mkdir(join(catalog, 'skills'));
  return { src, skill, catalog };
}

test('a skill with a link to a file outside it is refused and nothing is copied', { skip: !POSIX }, async () => {
  const { src, catalog } = await skillWith((skill, secret) => symlink(join(secret, 'id_rsa'), join(skill, 'ref.md')));
  await assert.rejects(() => installSkill({ source: src, CATALOG: catalog, force: true }), /enlace que sale|points outside/);
  assert.equal(existsSync(join(catalog, 'skills', 'evil-skill', 'ref.md')), false);
});

test('a link to a directory outside the skill is refused too', { skip: !POSIX }, async () => {
  const { src, catalog } = await skillWith((skill, secret) => symlink(secret, join(skill, 'docs'), 'dir'));
  await assert.rejects(() => installSkill({ source: src, CATALOG: catalog, force: true }), /enlace que sale|points outside/);
});

test('a dangling link is refused', { skip: !POSIX }, async () => {
  const { skill } = await skillWith((s) => symlink(join(s, 'nope.md'), join(s, 'broken.md')));
  await assert.rejects(() => copySkillTree(skill, join(tmpdir(), `chalc-s15-${Date.now()}`)), /enlace roto|broken link/);
});

test('links that stay inside the skill are copied with their content', { skip: !POSIX }, async () => {
  const { src, catalog } = await skillWith(async (skill) => {
    await writeFile(join(skill, 'real.md'), 'contenido');
    await symlink(join(skill, 'real.md'), join(skill, 'alias.md'));
  });
  await installSkill({ source: src, CATALOG: catalog, force: true });
  assert.equal(await readFile(join(catalog, 'skills', 'evil-skill', 'alias.md'), 'utf8'), 'contenido');
});
