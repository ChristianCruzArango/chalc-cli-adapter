// F-08 — rutas con acentos, espacios o comillas no desaparecen del alcance del portón.
//
// Sin `-z` ni `core.quotePath=false`, git devolvía `"src/a\303\261o.ts"`: una ruta que no existe, así
// que el archivo salía del alcance y, con otros cambios en la tarea, el portón aprobaba sin revisarlo.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { changedSince, changedLineInfo, headCommit } from '../catalog/gate/lib/changed.mjs';
import { parseHunks } from '../catalog/gate/lib/hunks.mjs';

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, stdio: 'ignore' });

const NAMES = ['src/año.ts', 'src/my file.ts', 'src/canción final.ts'];
if (process.platform !== 'win32') NAMES.push('src/it\'s "q".ts');

test('changed files keep their real names, committed or not', async () => {
  const root = await mkdtemp(join(tmpdir(), 'chalc-f08-'));
  git(root, 'init', '-q');
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'src/base.ts'), 'export const a = 1;\n');
  await writeFile(join(root, 'src/viejo.ts'), 'export const v = 1;\n');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'base');
  const base = await headCommit(root);

  await writeFile(join(root, NAMES[0]), 'export const x = 1;\n');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'one');
  for (const name of NAMES.slice(1)) await writeFile(join(root, name), 'export const y = 2;\n');
  await rename(join(root, 'src/viejo.ts'), join(root, 'src/nuevo ñ.ts'));
  git(root, 'add', '-A');

  const changed = await changedSince(root, base);
  for (const name of [...NAMES, 'src/nuevo ñ.ts']) assert.ok(changed.includes(name), `${name} in ${JSON.stringify(changed)}`);

  const { lines } = await changedLineInfo(root, base);
  assert.ok(lines.has('src/año.ts'), JSON.stringify([...lines.keys()]));
});

test('quoted diff headers are unescaped back to the real path', () => {
  const diff = '+++ "b/src/mi\\tarchivo \\"x\\".ts"\n@@ -0,0 +1,2 @@\n+a\n+b\n+++ "b/src/a\\303\\261o.ts"\n@@ -1 +1 @@\n+c\n';
  const map = parseHunks(diff);
  assert.deepEqual([...map.keys()], ['src/mi\tarchivo "x".ts', 'src/año.ts']);
  assert.deepEqual([...map.get('src/año.ts')], [1]);
});
