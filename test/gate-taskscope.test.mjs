// T6 (spec 013, R2/R5) — el alcance de la tarea, compuesto de sus tres fuentes.
//
// `resolveScope` decide la política con listas ya obtenidas; aquí se obtienen: la línea base de
// `.chalc/task.json`, el registro de `.chalc/task.files` y el diff de git. Es el único punto del
// alcance con efectos, y por eso es donde se comprueba que las piezas encajan de verdad —con repos
// reales— y no solo por separado.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, utimes, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { taskScope } from '../catalog/gate/lib/changed.mjs';
import { sealBaseline } from '../catalog/gate/lib/baseline.mjs';
import { recordTouched, TOUCHED_REL } from '../catalog/gate/lib/touched.mjs';

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

const plain = () => mkdtemp(join(tmpdir(), 'chalc-gate-taskscope-'));

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

// El ciclo completo, tal como pasa en un repo: se cierra una tarea, se sella la base, y la tarea
// siguiente solo ve lo suyo. Con la base de rama, `tarea1.ts` seguiría entrando en cada corrida.
test('a sealed baseline keeps the previous task out of the scope', async () => {
  const dir = await repo();
  await write(dir, 'src/tarea1.ts', 'export const a = 1;\n');
  const base = await commit(dir, 'tarea 1');
  await sealBaseline(dir, { commit: base });
  await write(dir, 'src/tarea2.ts', 'export const b = 2;\n');
  // La tarea 2 se COMMITEA. Es lo que separa este test de uno que no probaría nada: en la rama, la
  // base de rama es HEAD, así que con el trabajo sin commitear los dos caminos —línea base y base de
  // rama— darían el mismo resultado. Con el commit hecho, medir contra la rama daría cero archivos.
  await commit(dir, 'tarea 2');

  const scope = await taskScope(dir);

  assert.deepEqual(scope.files, ['src/tarea2.ts']);
  assert.equal(scope.source, 'baseline');
  assert.equal(scope.from, base);
});

// Sin línea base se mide contra la base de rama (R4). Es de más —arrastra las tareas anteriores—
// pero sigue siendo "archivos modificados", nunca el proyecto entero, y la procedencia lo declara.
test('with no baseline the scope falls back to the branch, and says so', async () => {
  const dir = await repo();
  await write(dir, 'src/tarea1.ts', 'export const a = 1;\n');
  await commit(dir, 'tarea 1');
  await write(dir, 'src/tarea2.ts', 'export const b = 2;\n');

  const scope = await taskScope(dir);

  assert.deepEqual(scope.files, ['src/tarea2.ts']);
  assert.equal(scope.source, 'branch');
  assert.equal(scope.undetermined, false);
});

// EL caso de la spec, extremo a extremo: el árbol arrastra trabajo de otra cosa y el registro dice
// qué es mío. Antes esto se resolvía revisándolo todo o no revisando; ahora el alcance sale limpio y
// el ruido queda declarado.
test('the registry keeps somebody else work in progress out of the scope', async () => {
  const dir = await repo();
  await write(dir, 'src/base.ts', 'export const a = 1;\n');
  const base = await commit(dir, 'tarea 1');
  await sealBaseline(dir, { commit: base });

  await write(dir, 'src/lo-mio.ts', 'export const b = 2;\n');
  await write(dir, 'src/trabajo-ajeno-a-medias.ts', 'export const c = 3;\n');
  await recordTouched(dir, ['src/lo-mio.ts']);

  const scope = await taskScope(dir);

  assert.deepEqual(scope.files, ['src/lo-mio.ts']);
  assert.equal(scope.source, 'registry');
  assert.deepEqual(scope.excluded, ['src/trabajo-ajeno-a-medias.ts']);
});

// Un proyecto sin git pero con harness: el registro basta. Es la prueba de que R10 no depende de git.
test('with no git at all, a registry is enough to determine the scope', async () => {
  const dir = await plain();
  await write(dir, 'src/lo-mio.ts', 'export const b = 2;\n');
  await recordTouched(dir, ['src/lo-mio.ts']);

  const scope = await taskScope(dir);

  assert.deepEqual(scope.files, ['src/lo-mio.ts']);
  assert.equal(scope.undetermined, false);
});

// R4b: sin git y sin registro no hay forma de saber qué tocó la tarea. Antes esto devolvía el árbol
// de fuentes ENTERO y el portón revisaba el proyecto llamándolo revisión de tarea. Ahora es un "no
// sé" explícito, y quien decide qué hacer con él es el portón.
test('with neither git nor registry the scope is undetermined, never the whole project', async () => {
  const dir = await plain();
  await write(dir, 'src/a.ts', 'export const a = 1;\n');
  await write(dir, 'src/b.ts', 'export const b = 2;\n');

  const scope = await taskScope(dir);

  assert.deepEqual(scope.files, []);
  assert.equal(scope.undetermined, true);
});

// El registro de la tarea ANTERIOR no puede colarse en esta. Si se heredara, el alcance crecería
// tarea a tarea hasta volver a ser el de la rama — el problema que la spec vino a arreglar.
test('a registry older than the baseline is ignored, and the scope says it', async () => {
  const dir = await repo();
  await write(dir, 'src/base.ts', 'export const a = 1;\n');
  const base = await commit(dir, 'tarea 1');

  await recordTouched(dir, ['src/de-la-tarea-anterior.ts']);
  const old = new Date(Date.now() - 86400000);
  await utimes(join(dir, TOUCHED_REL), old, old);
  await sealBaseline(dir, { commit: base });

  await write(dir, 'src/lo-de-hoy.ts', 'export const b = 2;\n');
  const scope = await taskScope(dir);

  assert.deepEqual(scope.files, ['src/lo-de-hoy.ts'], 'manda el diff, no el registro viejo');
  assert.equal(scope.staleRegistry, true, 'y se declara por qué no se usó el registro');
});

// R5 — cada lado o worktree lleva su `.chalc/`, así que su alcance es suyo. Sin código propio: sale
// de que todo lo que el alcance lee cuelga de esa carpeta.
test('each side keeps its own scope', async () => {
  const back = await plain();
  const front = await plain();
  await write(back, 'src/api.ts', 'export const a = 1;\n');
  await write(front, 'src/vista.ts', 'export const b = 2;\n');
  await recordTouched(back, ['src/api.ts']);
  await recordTouched(front, ['src/vista.ts']);

  assert.deepEqual((await taskScope(back)).files, ['src/api.ts']);
  assert.deepEqual((await taskScope(front)).files, ['src/vista.ts']);
});
