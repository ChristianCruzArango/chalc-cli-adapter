// T25 (R6) — el alcance de la revisión.
//
// Acotar a lo cambiado es lo que hace usable al portón. Pero un repo sin git no puede convertirse en
// "no hay nada que revisar": eso sería un aprobado silencioso, que es exactamente lo que esta spec
// viene a quitar. Sin git se revisa el árbol de fuentes.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { changedFiles } from '../catalog/gate/lib/changed.mjs';

async function project(files) {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-gate-changed-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, 'utf8');
  }
  return dir;
}

test('changedFiles falls back to the source tree when the folder is not a git repo', async () => {
  const dir = await project({
    'src/precio.ts': 'export const p = 1;\n',
    'lib/pagina.dart': 'class X {}\n'
  });

  const files = await changedFiles(dir);

  assert.deepEqual(files, ['lib/pagina.dart', 'src/precio.ts']);
});

test('the fallback skips dependencies and build output', async () => {
  const dir = await project({
    'src/precio.ts': 'export const p = 1;\n',
    'node_modules/x/index.js': 'module.exports = 1;\n',
    'dist/bundle.js': 'var a = 1;\n',
    '.chalc/gate/lib/smells.mjs': 'export const x = 1;\n'
  });

  const files = await changedFiles(dir);

  assert.deepEqual(files, ['src/precio.ts']);
});

test('the fallback skips what the gate cannot lint anyway', async () => {
  const dir = await project({
    'src/precio.ts': 'export const p = 1;\n',
    'README.md': '# hola\n',
    'assets/logo.png': 'binario\n'
  });

  const files = await changedFiles(dir);

  assert.deepEqual(files, ['src/precio.ts']);
});
