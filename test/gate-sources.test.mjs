// El recorrido del árbol de fuentes y el predicado de "qué es código del usuario".
//
// Las dos primeras pruebas venían de `gate-changed`, donde cubrían el respaldo sin git de
// `changedFiles`. La spec 013 (R4b) quitó ese respaldo —sin git el alcance es "no sé", nunca el
// proyecto entero—, pero el recorrido sigue vivo: lo usa la etapa de duplicación para responder
// "esto ya existía en otro archivo". Las reglas de exclusión se prueban aquí, que es de quien son.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { isUserSource, sourceFiles } from '../catalog/gate/lib/sources.mjs';

async function project(files) {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-gate-sources-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, 'utf8');
  }
  return dir;
}

test('sourceFiles walks the user source tree', async () => {
  const dir = await project({
    'src/precio.ts': 'export const p = 1;\n',
    'lib/pagina.dart': 'class X {}\n'
  });

  assert.deepEqual((await sourceFiles(dir)).files, ['lib/pagina.dart', 'src/precio.ts']);
});

test('sourceFiles skips dependencies, build output and chalc own artifacts', async () => {
  const dir = await project({
    'src/precio.ts': 'export const p = 1;\n',
    'node_modules/x/index.js': 'module.exports = 1;\n',
    'dist/bundle.js': 'var a = 1;\n',
    '.chalc/gate/lib/smells.mjs': 'export const x = 1;\n'
  });

  assert.deepEqual((await sourceFiles(dir)).files, ['src/precio.ts']);
});

test('sourceFiles skips what the gate cannot lint anyway', async () => {
  const dir = await project({
    'src/precio.ts': 'export const p = 1;\n',
    'README.md': '# hola\n',
    'assets/logo.png': 'binario\n'
  });

  assert.deepEqual((await sourceFiles(dir)).files, ['src/precio.ts']);
});

// El predicado responde la misma pregunta que el recorrido, pero para una ruta que llega de fuera:
// de git, o del registro de rutas escritas de la spec 013. Vive junto al recorrido para que no haya
// dos versiones de "qué es fuente del usuario" que se desincronicen.
test('isUserSource answers the same question for a path that comes from elsewhere', () => {
  assert.equal(isUserSource('src/precio.ts'), true);
  assert.equal(isUserSource('src\\precio.ts'), true, 'da igual el separador');
  assert.equal(isUserSource('README.md'), false);
  assert.equal(isUserSource('specs/001-demo/tasks.md'), false);
  assert.equal(isUserSource('.chalc/gate.md'), false);
  assert.equal(isUserSource('.chalc/next/lib/decide.mjs'), false, 'ni el código que emite chalc');
});

// `bin/` y `obj/` están en SKIP_DIRS para no ENTRAR en ellos al recorrer, pero aplicar esa lista a
// cada segmento de una ruta que ya viene de git excluiría fuentes legítimas: este mismo repo tiene
// `bin/chalc.mjs`. Lo que llega por git ya pasó por el .gitignore del proyecto.
test('isUserSource does not confuse a real bin folder with build output', () => {
  assert.equal(isUserSource('bin/chalc.mjs'), true);
});
