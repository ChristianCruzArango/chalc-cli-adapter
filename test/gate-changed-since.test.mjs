// T3 (spec 013, R2/R4b) — el diff acotado a una referencia.
//
// `changedFiles` mide contra la base de la RAMA, que son todas las tareas anteriores juntas. Esto es
// la pieza que permite medir contra la línea base de UNA tarea. Y la diferencia que más importa está
// en el fallo: sin repo devuelve `null` —"no sé"— en vez del árbol de fuentes entero. Revisar el
// proyecto entero no es revisar de más, es cambiar de pregunta (R4b), y quien decide qué hacer con
// un "no sé" es el portón, que bloquea.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { changedSince, isRepo, mergeBase } from '../catalog/gate/lib/changed.mjs';

const git = (dir, args) => new Promise((resolve) => {
  let out = '';
  const child = spawn('git', args, { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] });
  child.stdout.on('data', (chunk) => { out += chunk; });
  child.on('error', () => resolve(''));
  child.on('close', () => resolve(out.trim()));
});

async function write(dir, rel, content) {
  const abs = join(dir, rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content, 'utf8');
}

const plain = () => mkdtemp(join(tmpdir(), 'chalc-gate-since-'));

// Un repo de verdad con commits: la referencia de la línea base es un commit, así que no hay forma
// de ejercitar esto contra un doble.
async function repo() {
  const dir = await plain();
  await git(dir, ['init', '-q', '-b', 'main', '.']);
  await git(dir, ['config', 'user.email', 'test@chalc.dev']);
  await git(dir, ['config', 'user.name', 'chalc test']);
  await git(dir, ['config', 'commit.gpgsign', 'false']);
  return dir;
}

async function commit(dir, message) {
  await git(dir, ['add', '-A']);
  await git(dir, ['commit', '-q', '-m', message]);
  return git(dir, ['rev-parse', 'HEAD']);
}

test('changedSince says "I do not know" outside a git repo', async () => {
  assert.equal(await changedSince(await plain(), 'a1b2c3d4e5'), null);
});

// Sin repo Y sin referencia: es el caso al que llega un proyecto que no usa git, y el que decide si
// R4b se cumple. Sin la comprobación explícita de repo, `git status` falla en silencio y la función
// devolvería `[]` — «no cambió nada»—, que es el aprobado silencioso que la spec prohíbe. Con
// referencia el fallo del `git diff` ya delata que no hay repo; sin ella, no lo delata nadie.
test('changedSince says "I do not know" outside a git repo with no reference either', async () => {
  assert.equal(await changedSince(await plain(), ''), null);
});

test('isRepo distinguishes a git repo from a plain folder', async () => {
  assert.equal(await isRepo(await repo()), true);
  assert.equal(await isRepo(await plain()), false);
});

// El corazón de la spec: lo de la tarea anterior queda fuera. Con la base de rama, `viejo.ts` seguiría
// entrando en cada corrida hasta que la rama se fusionara.
test('changedSince only reports what changed after the given reference', async () => {
  const dir = await repo();
  await write(dir, 'src/viejo.ts', 'export const a = 1;\n');
  const base = await commit(dir, 'tarea anterior');
  await write(dir, 'src/nuevo.ts', 'export const b = 2;\n');
  await commit(dir, 'tarea de hoy');

  const files = await changedSince(dir, base);

  assert.deepEqual(files, ['src/nuevo.ts']);
});

test('changedSince includes work that is not committed yet', async () => {
  const dir = await repo();
  await write(dir, 'src/viejo.ts', 'export const a = 1;\n');
  const base = await commit(dir, 'tarea anterior');
  await write(dir, 'src/a_medias.ts', 'export const c = 3;\n');

  assert.deepEqual(await changedSince(dir, base), ['src/a_medias.ts']);
});

// Las mismas exclusiones que ya aplicaba `changedFiles`: la evidencia que el portón acaba de escribir
// no es trabajo por medir, y marcar un checkbox en tasks.md tampoco.
test('changedSince keeps out what is not user source', async () => {
  const dir = await repo();
  await write(dir, 'src/viejo.ts', 'export const a = 1;\n');
  const base = await commit(dir, 'tarea anterior');
  await write(dir, 'src/nuevo.ts', 'export const b = 2;\n');
  await write(dir, '.chalc/gate.md', '# evidencia\n');
  await write(dir, 'specs/001-demo/tasks.md', '- [x] T1\n');
  await write(dir, 'README.md', '# demo\n');

  assert.deepEqual(await changedSince(dir, base), ['src/nuevo.ts']);
});

// Una línea base que apunta a un commit que ya no existe —rebase, rama recreada— no puede dar un
// alcance vacío: eso sería "no cambió nada", que R13 prohíbe confundir con aprobado. Es un "no sé",
// y el portón cae al respaldo declarado de R4.
test('changedSince says "I do not know" when the reference does not resolve', async () => {
  const dir = await repo();
  await write(dir, 'src/viejo.ts', 'export const a = 1;\n');
  await commit(dir, 'tarea anterior');

  assert.equal(await changedSince(dir, 'deadbeefdeadbeef'), null);
});

test('mergeBase finds the branch point and gives nothing outside a repo', async () => {
  const dir = await repo();
  await write(dir, 'src/viejo.ts', 'export const a = 1;\n');
  const head = await commit(dir, 'tarea anterior');

  assert.equal(await mergeBase(dir), head, 'en main, la base es HEAD');
  assert.equal(await mergeBase(await plain()), '');
});
