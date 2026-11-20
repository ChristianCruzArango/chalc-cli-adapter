// NestJS se equipa con las skills oficiales del equipo de NestJS (github.com/nestjs/agent-skills), sin la
// skill de la comunidad que había antes, y `chalc init nestjs` crea proyectos Nest 12 cuando el Node lo permite.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { detectContext, matchRules } from '../lib/detect.mjs';
import { loadJsonDir } from '../lib/commands/catalogstore.mjs';
import { folderGuide } from '../lib/init-folders.mjs';
import { nestNewArgs } from '../lib/init-cli.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKILLS = join(ROOT, 'catalog', 'skills');
const NEST_SKILLS = ['nestjs', 'nestjs-feature', 'nestjs-auth', 'nestjs-data', 'nestjs-testing', 'nestjs-production'];
const OLD = 'nestjs-best-practices';

async function skillsFor(files) {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-nest-'));
  for (const [name, content] of Object.entries(files)) await writeFile(join(dir, name), typeof content === 'string' ? content : JSON.stringify(content));
  return matchRules(await loadJsonDir(join(ROOT, 'rules')), await detectContext(dir)).flatMap((r) => r.skills || []);
}
const deps = (...names) => ({ 'package.json': { name: 'x', dependencies: Object.fromEntries(names.map((n) => [n, '1'])) } });

test('las 6 skills oficiales de NestJS están vendorizadas y bloqueadas con su fuente', async () => {
  const lock = JSON.parse(await readFile(join(ROOT, 'skills-lock.json'), 'utf8'));
  for (const id of NEST_SKILLS) {
    assert.ok(existsSync(join(SKILLS, id, 'SKILL.md')), `${id}: falta SKILL.md`);
    const entry = lock.skills[id];
    assert.ok(entry, `${id}: sin entrada en skills-lock.json`);
    assert.equal(entry.sourceType, 'skillssh', id);
    assert.ok(entry.source.includes('github.com/nestjs/agent-skills') && entry.source.includes(`--skill ${id} `), `${id}: ${entry.source}`);
  }
});

test('la skill de la comunidad nestjs-best-practices ya no está en el catálogo ni en el lock', async () => {
  const lock = JSON.parse(await readFile(join(ROOT, 'skills-lock.json'), 'utf8'));
  assert.equal(existsSync(join(SKILLS, OLD)), false);
  assert.equal(Object.hasOwn(lock.skills, OLD), false);
});

test('un proyecto NestJS recibe exactamente las 6 skills oficiales (por dependencia o por nest-cli.json)', async () => {
  for (const files of [deps('@nestjs/core'), { 'nest-cli.json': '{}' }]) {
    const skills = await skillsFor(files);
    for (const id of NEST_SKILLS) assert.ok(skills.includes(id), `${Object.keys(files)} → ${id}`);
    assert.ok(!skills.includes(OLD));
    for (const ui of ['interface-design', 'responsive-design', 'frontend-design']) assert.ok(!skills.includes(ui), ui);
  }
});

test('un proyecto que no es NestJS no recibe ninguna skill de NestJS', async () => {
  for (const files of [deps('fastify'), deps('@angular/core'), deps('react', 'react-dom')]) {
    const skills = await skillsFor(files);
    for (const id of NEST_SKILLS) assert.ok(!skills.includes(id), `${JSON.stringify(files)} → ${id}`);
  }
});

test('las guías por carpeta de NestJS recomiendan la skill oficial que toca a cada carpeta', () => {
  const expected = {
    'src/common': ['nestjs-feature'],
    'src/modules': ['nestjs-feature', 'nestjs-data'],
    'src/config': ['nestjs-production'],
    'src/health': ['nestjs-production'],
    'src/infrastructure': ['nestjs-data'],
    'src/testing': ['nestjs-testing', 'mutation-testing'],
    libs: ['nestjs']
  };
  for (const [folder, skills] of Object.entries(expected)) assert.deepEqual(folderGuide('nestjs', folder).skills, skills, folder);
  // Los demás stacks no cambian: Fastify sigue con lo suyo.
  assert.deepEqual(folderGuide('fastify', 'src/modules').skills, ['fastify-best-practices']);
  assert.deepEqual(folderGuide('fastify', 'src/common').skills, ['solid-principles']);
});

test('nest new con el CLI 12 recibe --observe; con el 11 y el 10, no', () => {
  const base = (tag) => ['--yes', `@nestjs/cli@${tag}`, 'new', 'api', '--skip-git', '--package-manager', 'npm'];
  assert.deepEqual(nestNewArgs('api', 'v24.18.0'), [...base('12.0.12'), '--observe']);
  assert.deepEqual(nestNewArgs('api', 'v22.22.3'), [...base('12.0.12'), '--observe']);
  assert.deepEqual(nestNewArgs('api', 'v22.20.0'), base('11.0.24'));
  assert.deepEqual(nestNewArgs('api', 'v18.0.0'), base('10.4.9'));
});
