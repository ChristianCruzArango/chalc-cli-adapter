// S-13 — el enlace `> Spec:` de plan.md no puede sacar archivos de fuera del proyecto.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { specInfo } from '../cli/engine/planfile.mjs';

async function project(link) {
  const outside = await mkdtemp(join(tmpdir(), 'chalc-s13-out-'));
  await writeFile(join(outside, 'id_rsa.md'), 'PRIVATE KEY');
  const root = await mkdtemp(join(tmpdir(), 'chalc-s13-'));
  await mkdir(join(root, '.chalc'), { recursive: true });
  await mkdir(join(root, 'specs', '001-x'), { recursive: true });
  await writeFile(join(root, 'specs', '001-x', 'spec.md'), '# Spec real');
  await writeFile(join(root, '.env'), 'API_KEY=secret');
  const target = typeof link === 'function' ? await link(root, outside) : link;
  await writeFile(join(root, '.chalc', 'plan.md'), `# Plan\n\n> Spec: ${target}\n`);
  return root;
}

test('a spec inside the project is still loaded', async () => {
  assert.equal(specInfo(await project('specs/001-x/spec.md')).text, '# Spec real');
});

test('traversal, absolute paths and non-markdown files are ignored', async () => {
  for (const link of [
    (root, outside) => `../${join('..', outside.split('/').pop())}/id_rsa.md`,
    (root, outside) => join(outside, 'id_rsa.md'),
    '.env'
  ]) {
    assert.deepEqual(specInfo(await project(link)), { rel: '', text: '' });
  }
});

test('a symlink inside the project pointing outside is ignored', { skip: process.platform === 'win32' }, async () => {
  const root = await project(async (r, outside) => { await symlink(join(outside, 'id_rsa.md'), join(r, 'specs', 'leak.md')); return 'specs/leak.md'; });
  assert.deepEqual(specInfo(root), { rel: '', text: '' });
});
