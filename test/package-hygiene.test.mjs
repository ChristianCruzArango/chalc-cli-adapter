// M-09 — el paquete publica solo lo que sirve al usuario y el repo no arrastra salidas locales.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKILLS = join(ROOT, 'catalog', 'skills');

test('vendored skills ship no upstream CI workflows or build lockfiles', async () => {
  for (const id of await readdir(SKILLS)) {
    assert.equal(existsSync(join(SKILLS, id, '.github')), false, `${id}/.github`);
    assert.equal(existsSync(join(SKILLS, id, 'scripts', 'package-lock.json')), false, `${id}/scripts/package-lock.json`);
  }
});

test('local document outputs are ignored by git', async () => {
  const ignore = (await readFile(join(ROOT, '.gitignore'), 'utf8')).split(/\r?\n/);
  assert.ok(ignore.includes('output/'));
});

test('npm scripts do not shadow npm built-in command names', async () => {
  const { scripts } = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  for (const builtin of ['init', 'update', 'install', 'publish']) assert.equal(builtin in scripts, false, builtin);
});

test('every declared bin is executable', { skip: process.platform === 'win32' }, async () => {
  const { bin } = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  for (const file of Object.values(bin)) assert.ok((await stat(join(ROOT, file))).mode & 0o111, file);
});
