// M-01 — chalc cumple las reglas de tamaño que su propio portón exige a los proyectos que equipa
// (funciones ≤ 40 líneas, archivos ≤ 300), medidas con el MISMO linter del portón.
//
// Hubo una lista de excepciones que solo podía encoger; llegó a vacía y se retiró: desde entonces no
// hay excepciones, y una función o un archivo por encima del límite rompe la suite.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintSource } from '../catalog/gate/lib/smells.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIRS = ['bin', 'cli', 'lib', 'targets', 'catalog/gate', 'catalog/next', 'catalog/memory', 'catalog/mail'];
const LIMITS = { maxFileLines: 300, maxFunctionLines: 40, maxParams: 4, maxDepth: 3 };

async function* sources(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* sources(p);
    else if (p.endsWith('.mjs')) yield p;
  }
}

async function measure() {
  const found = {};
  for (const dir of DIRS) {
    for await (const file of sources(join(ROOT, dir))) {
      const rel = relative(ROOT, file).replace(/\\/g, '/');
      for (const f of lintSource(await readFile(file, 'utf8'), { file: rel, limits: LIMITS })) {
        if (f.rule === 'file-too-long') found[rel] = f.data.lines;
        if (f.rule === 'function-too-long') found[`${rel}::${f.data.name}`] = Math.max(found[`${rel}::${f.data.name}`] || 0, f.data.lines);
      }
    }
  }
  return found;
}

test('no function or file exceeds the gate size limits', async () => {
  assert.deepEqual(await measure(), {}, 'funciones o archivos por encima del límite: pártelos en piezas con una responsabilidad');
});
