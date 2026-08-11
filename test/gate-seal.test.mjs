// T11 (spec 013, R1) — sellar la línea base al cerrar tarea.
//
// Es lo que cierra el ciclo sobre sí mismo: mientras nadie marque dónde acabó una tarea, la
// siguiente no tiene desde dónde medir y todo lo anterior se queda en teoría. Lo sella el portón
// porque es el único de los tres que escribe estado y sabe cuándo una corrida cierra tarea; el
// advisor no puede, que la spec 008 (R8) lo declara de solo lectura.
//
// Y sella SOLO al cerrar. Una corrida que no cierra tarea —falló, o fue `--fast`— movería la
// referencia al medio de la tarea en curso, y a partir de ahí el portón revisaría solo la mitad de
// lo que se escribió después. Un alcance de menos no se nota: aprueba.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { runGate } from '../catalog/gate/gate.mjs';
import { readBaseline } from '../catalog/gate/lib/baseline.mjs';
import { readTouched, TOUCHED_REL } from '../catalog/gate/lib/touched.mjs';

// Sin herramienta de mutación y con `required: false`, la etapa se salta como "no aplica" y la
// corrida puede aprobar — que es lo que hace falta para ejercitar el cierre de tarea.
const CONFIG = {
  stack: 'js',
  test: { command: 'npm test' },
  mutation: { tool: '', command: '', report: '', format: '', threshold: 80, required: false, scopeFlag: '' },
  lint: { maxFileLines: 300, maxFunctionLines: 40, maxParams: 4, maxDepth: 3, duplication: { enabled: false } },
  spec: { dir: 'specs' },
  role: 'back',
  language: 'es'
};

async function project(files = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-gate-seal-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, typeof content === 'string' ? content : JSON.stringify(content, null, 2), 'utf8');
  }
  return dir;
}

const git = (dir, args) => new Promise((resolve) => {
  let out = '';
  const child = spawn('git', args, { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] });
  child.stdout.on('data', (chunk) => { out += chunk; });
  child.on('error', () => resolve(''));
  child.on('close', () => resolve(out.trim()));
});

const equipped = (extra = {}) => project({
  '.chalc/gate.json': CONFIG,
  'specs/013-alcance/spec.md': '- **R1** — WHEN algo THE SYSTEM SHALL otra cosa.',
  ...extra
});

// Un repo donde la tarea en curso escribió `src/nuevo.ts` y lo dejó anotado.
async function midTask() {
  const dir = await equipped({ 'src/base.ts': 'export const base = () => 1;\n' });
  await git(dir, ['init', '-q', '-b', 'main', '.']);
  await git(dir, ['config', 'user.email', 'test@chalc.dev']);
  await git(dir, ['config', 'user.name', 'chalc test']);
  await git(dir, ['config', 'commit.gpgsign', 'false']);
  await git(dir, ['add', '-A']);
  await git(dir, ['commit', '-q', '-m', 'base']);

  await writeFile(join(dir, 'src', 'nuevo.ts'), 'export const n = 1;\n', 'utf8');
  await writeFile(join(dir, TOUCHED_REL), 'src/nuevo.ts\n', 'utf8');
  return dir;
}

const ok = async () => ({ code: 0, ms: 1 });
const failing = async (command) => ({ code: command.startsWith('npm test') ? 1 : 0, ms: 1 });

test('closing a task seals the baseline at the current commit', async () => {
  const dir = await midTask();

  const result = await runGate({ root: dir, run: ok });

  assert.equal(result.closesTask, true, 'el escenario tiene que cerrar tarea para probar nada');
  assert.equal((await readBaseline(dir)).commit, await git(dir, ['rev-parse', 'HEAD']));
});

// Si el registro sobreviviera al cierre, la tarea siguiente heredaría los archivos de esta y el
// alcance crecería tarea a tarea hasta volver a ser el de la rama.
test('closing a task clears the record of written paths', async () => {
  const dir = await midTask();

  await runGate({ root: dir, run: ok });

  assert.deepEqual((await readTouched(dir)).files, []);
});

// El ciclo completo, que es de lo que iba la spec: cerrada la tarea y commiteada, la corrida
// siguiente ya no la ve. Antes `src/nuevo.ts` habría seguido apareciendo en cada informe hasta
// fusionar la rama.
test('the next run no longer sees the task that just closed', async () => {
  const dir = await midTask();
  await git(dir, ['add', '-A']);
  await git(dir, ['commit', '-q', '-m', 'tarea hecha']);

  await runGate({ root: dir, run: ok });
  const again = await runGate({ root: dir, run: ok });
  const state = JSON.parse(await readFile(join(dir, '.chalc', 'gate.state.json'), 'utf8'));

  assert.deepEqual(state.scope.files, []);
  assert.notEqual(again.verdict, 'pass', 'y sin nada que revisar no aprueba');
});

// El límite del sello, escrito para que nadie lo descubra por sorpresa: la línea base es un COMMIT,
// así que si el trabajo de la tarea sigue sin commitear, sigue siendo un cambio posterior a ella y
// entra en el alcance de la tarea siguiente. No es un fallo del sello —ese archivo está modificado
// de verdad respecto a la referencia—, es el límite de lo que un commit puede acotar.
//
// Para eso está el registro (R10), que es la fuente precisa: se vacía al cerrar y no arrastra nada.
// El diff es el respaldo grueso, y el respaldo revisa de más, nunca de menos.
test('with the work uncommitted, the baseline alone cannot isolate the task', async () => {
  const dir = await midTask();
  await runGate({ root: dir, run: ok });

  const state = JSON.parse(await readFile(join(dir, '.chalc', 'gate.state.json'), 'utf8'));
  assert.deepEqual(state.scope.files, ['src/nuevo.ts'], 'la primera corrida sí lo revisó, por el registro');

  await runGate({ root: dir, run: ok });
  const again = JSON.parse(await readFile(join(dir, '.chalc', 'gate.state.json'), 'utf8'));

  assert.deepEqual(again.scope.files, ['src/nuevo.ts'], 'y sin registro, el diff lo sigue viendo');
  assert.equal(again.scope.source, 'baseline');
});

// ── lo que NO sella ───────────────────────────────────────────────────────────────────────────

test('a fast run does not move the reference, even passing', async () => {
  const dir = await midTask();

  const result = await runGate({ root: dir, run: ok, fast: true });

  assert.equal(result.closesTask, false);
  assert.equal((await readBaseline(dir)).exists, false);
  assert.deepEqual((await readTouched(dir)).files, ['src/nuevo.ts'], 'ni vacía el registro');
});

test('a failing run does not seal anything', async () => {
  const dir = await midTask();

  await runGate({ root: dir, run: failing });

  assert.equal((await readBaseline(dir)).exists, false);
  assert.deepEqual((await readTouched(dir)).files, ['src/nuevo.ts']);
});

// ── sin git ───────────────────────────────────────────────────────────────────────────────────

// Sin repo no hay commit que sellar, y escribir una referencia inservible sería peor que no tener
// ninguna. El registro sí se vacía: es de la tarea que acaba de cerrarse, venga de donde venga.
test('with no git, closing a task clears the record and writes no bogus baseline', async () => {
  const dir = await equipped({ 'src/nuevo.ts': 'export const n = 1;\n' });
  await writeFile(join(dir, TOUCHED_REL), 'src/nuevo.ts\n', 'utf8');

  const result = await runGate({ root: dir, run: ok });

  assert.equal(result.closesTask, true);
  assert.equal((await readBaseline(dir)).exists, false);
  assert.equal(existsSync(join(dir, TOUCHED_REL)), false);
});
