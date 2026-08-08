// T17 (R6) — fronteras de arquitectura sobre los archivos CAMBIADOS.
//
// El portón no reimplementa este linter: usa el de chalc (`verify-boundaries.mjs`, que se copia al
// repo como `.chalc/gate/lib/boundaries.mjs`). Lo que falta para que sirva en el portón es poder
// acotarlo a los archivos de la tarea y que cada violación traiga su línea, porque R6 exige archivo
// Y línea. Ambas cosas se añaden a la fuente única, no a una copia.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { lintBoundaries, lintBoundariesIn, importsWithLines } from '../lib/verify-boundaries.mjs';

async function project(files) {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-gate-bounds-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, 'utf8');
  }
  return dir;
}

const violating = [
  '// precio del dominio',
  "import { conectar } from '../infrastructure/db';",
  '',
  'export const precio = () => conectar();'
].join('\n');

test('importsWithLines reports the line of every import', async () => {
  const found = importsWithLines(violating, 'ts');

  assert.deepEqual(found, [{ path: '../infrastructure/db', line: 2 }]);
});

test('importsWithLines keeps requires and imports in source order', async () => {
  const found = importsWithLines("import { A } from '../domain/a';\n\nrequire('x');", 'ts');

  assert.deepEqual(found.map((i) => [i.path, i.line]), [['../domain/a', 1], ['x', 3]]);
});

test('lintBoundariesIn analyses only the files of the task', async () => {
  const dir = await project({
    'src/domain/precio.ts': violating,
    'src/domain/otro.ts': violating   // rompe igual, pero no entró en esta tarea
  });

  const violations = await lintBoundariesIn(dir, ['src/domain/precio.ts']);

  assert.equal(violations.length, 1);
  assert.equal(violations[0].file, 'src/domain/precio.ts');
  assert.equal(violations[0].kind, 'layer');
});

test('lintBoundariesIn reports the line of the offending import', async () => {
  const dir = await project({ 'src/domain/precio.ts': violating });

  const [violation] = await lintBoundariesIn(dir, ['src/domain/precio.ts']);

  assert.equal(violation.line, 2);
  assert.equal(violation.from, 'domain');
  assert.equal(violation.to, 'infrastructure');
});

test('lintBoundariesIn reports a feature importing another feature', async () => {
  const dir = await project({
    'src/features/carrito/total.ts': "import { user } from '../perfil/user';\n"
  });

  const [violation] = await lintBoundariesIn(dir, ['src/features/carrito/total.ts']);

  assert.equal(violation.kind, 'feature');
  assert.equal(violation.line, 1);
});

// El diff de una tarea trae specs, markdown, tests y archivos borrados. Nada de eso es una frontera.
test('lintBoundariesIn skips what it must not analyse', async () => {
  const dir = await project({
    'src/domain/precio.spec.ts': violating,
    'specs/007/plan.md': '# plan\n'
  });

  const violations = await lintBoundariesIn(dir, [
    'src/domain/precio.spec.ts',   // test: no es código de producción
    'specs/007/plan.md',           // no es fuente
    'src/domain/borrado.ts'        // borrado en la tarea
  ]);

  assert.deepEqual(violations, []);
});

// El recorrido del proyecto entero sigue siendo el mismo linter: una sola implementación.
test('lintBoundaries keeps scanning the whole project and now carries the line', async () => {
  const dir = await project({ 'src/domain/precio.ts': violating });

  const violations = await lintBoundaries(dir);

  assert.equal(violations.length, 1);
  assert.equal(violations[0].line, 2);
});
