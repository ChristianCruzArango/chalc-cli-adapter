import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { copyMethodScaffolds } from '../lib/targetkit.mjs';

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
