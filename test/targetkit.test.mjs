import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { copyMethodScaffolds, writeManagedBlock, START, END } from '../lib/targetkit.mjs';

// El CLAUDE.md del usuario es SAGRADO: writeManagedBlock solo toca el bloque entre marcadores.
test('writeManagedBlock preserva el contenido del usuario al insertar el bloque por primera vez', async () => {
  const base = await mkdtemp(join(tmpdir(), 'chalc-mb-'));
  const file = join(base, 'CLAUDE.md');
  await writeFile(file, '# Mi proyecto\n\nReglas del usuario (NO BORRAR).\n', 'utf8');
  await writeManagedBlock(file, `${START}\n## Chalc\n${END}`);
  const out = await readFile(file, 'utf8');
  assert.ok(out.includes('Reglas del usuario (NO BORRAR).'), 'no debe borrar lo del usuario');
  assert.ok(out.includes('## Chalc'));
});

// Regresión: un bloque con `$` (ej. $HOME, $&, $', $1 en ejemplos de shell/regex) NO debe
// interpretarse como referencias de String.replace ni corromper/duplicar/borrar contenido.
test('writeManagedBlock reemplaza solo su bloque y trata los `$` como literales', async () => {
  const base = await mkdtemp(join(tmpdir(), 'chalc-mb-'));
  const file = join(base, 'CLAUDE.md');
  const top = '# Mi proyecto\n\nArriba del usuario (NO BORRAR).\n\n';
  const bottom = '\n\n## Notas al final\nAbajo del usuario.\n';
  await writeFile(file, `${top}${START}\n## bloque viejo\n${END}${bottom}`, 'utf8');

  const dollarApos = '$' + "'x'";
  const block = `${START}\n## Chalc\nEjemplo $& y $HOME y ${dollarApos} y precio $100\n${END}`;
  await writeManagedBlock(file, block);

  const out = await readFile(file, 'utf8');
  assert.ok(out.includes('Arriba del usuario (NO BORRAR).'), 'preserva contenido de arriba');
  assert.ok(out.includes('Abajo del usuario.'), 'preserva contenido de abajo');
  assert.ok(out.includes(`Ejemplo $& y $HOME y ${dollarApos} y precio $100`), 'el bloque queda literal');
  assert.ok(!out.includes('bloque viejo'), 'el bloque viejo fue reemplazado');
  // Un solo par de marcadores (no anidados/duplicados).
  assert.equal(out.split(START).length - 1, 1, 'un solo START');
  assert.equal(out.split(END).length - 1, 1, 'un solo END');
});

// El scaffold del método (specs/ del SDD) es contenido del PROYECTO: debe copiarse con cualquier target.
test('copyMethodScaffolds copies the method scaffold into the project', async () => {
  const base = await mkdtemp(join(tmpdir(), 'chalc-scaffold-'));
  const scaffoldDir = join(base, 'scaffold');
  await mkdir(join(scaffoldDir, 'specs', '_template'), { recursive: true });
  await writeFile(join(scaffoldDir, 'specs', 'constitution.md'), '# Constitución', 'utf8');
  const project = join(base, 'project');
  await mkdir(project, { recursive: true });

  await copyMethodScaffolds([{ id: 'sdd', mode: 'lite', scaffoldDir }], project);

  assert.ok(existsSync(join(project, 'specs', 'constitution.md')), 'specs/ debe crearse');
  assert.ok(existsSync(join(project, 'specs', '_template')));
});

test('copyMethodScaffolds never overwrites the user files', async () => {
  const base = await mkdtemp(join(tmpdir(), 'chalc-scaffold-'));
  const scaffoldDir = join(base, 'scaffold');
  await mkdir(join(scaffoldDir, 'specs'), { recursive: true });
  await writeFile(join(scaffoldDir, 'specs', 'constitution.md'), 'PLANTILLA', 'utf8');
  const project = join(base, 'project');
  await mkdir(join(project, 'specs'), { recursive: true });
  await writeFile(join(project, 'specs', 'constitution.md'), 'MÍO', 'utf8');   // el usuario ya editó

  await copyMethodScaffolds([{ id: 'sdd', mode: 'lite', scaffoldDir }], project);

  assert.equal(await readFile(join(project, 'specs', 'constitution.md'), 'utf8'), 'MÍO');   // no se pisa
});

test('copyMethodScaffolds is a no-op when there are no methods or no scaffoldDir', async () => {
  const base = await mkdtemp(join(tmpdir(), 'chalc-scaffold-'));
  await copyMethodScaffolds([], base);
  await copyMethodScaffolds([{ id: 'x', scaffoldDir: join(base, 'nope') }], base);   // dir inexistente: ignora
  await copyMethodScaffolds(undefined, base);
  assert.ok(true);
});
