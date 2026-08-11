// T9 (spec 013, R6/R11) — las etapas miden el alcance de LA TAREA, no el de la rama.
//
// Las piezas anteriores calculan bien el alcance; esto comprueba que llega hasta donde tiene que
// llegar. Es la diferencia que se nota al usarlo: con el alcance de rama, el `console.log` que
// dejaste en la tarea 1 vuelve a salir en el informe de la tarea 2, y de la 3, y de la 4 — hasta que
// la rama se fusiona. Un informe que repite lo mismo cada vez se deja de leer, y con él se van los
// hallazgos que sí eran de hoy.
//
// La duplicación es el caso especial (R11): esa etapa SÍ lee el árbol entero, porque su pregunta es
// "¿esto ya existía en otro archivo?". Lo que se acota es lo que REPORTA — hace falta tener una punta
// en el alcance.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { runGate } from '../catalog/gate/gate.mjs';
import { RULES } from '../catalog/gate/lib/rules.mjs';
import { sealBaseline } from '../catalog/gate/lib/baseline.mjs';

const CONFIG = {
  stack: 'js',
  test: { command: 'npm test' },
  mutation: { tool: '', command: '', report: '', format: '', threshold: 80, required: false, scopeFlag: '' },
  lint: { maxFileLines: 300, maxFunctionLines: 40, maxParams: 4, maxDepth: 3, duplication: { enabled: true, minLines: 6, maxFiles: 4000 } },
  spec: { dir: 'specs' },
  role: 'back',
  language: 'es'
};

async function project(files = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-gate-scoped-'));
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

// Cierra la tarea anterior: todo lo que hay dentro queda commiteado y sellado como línea base.
async function previousTaskClosed(dir) {
  await git(dir, ['init', '-q', '-b', 'main', '.']);
  await git(dir, ['config', 'user.email', 'test@chalc.dev']);
  await git(dir, ['config', 'user.name', 'chalc test']);
  await git(dir, ['config', 'commit.gpgsign', 'false']);
  await git(dir, ['add', '-A']);
  await git(dir, ['commit', '-q', '-m', 'tarea anterior']);
  await sealBaseline(dir, { commit: await git(dir, ['rev-parse', 'HEAD']) });
}

const run = async () => ({ code: 0, ms: 1 });

const filesWith = (result, rule) => result.stages
  .flatMap((s) => s.findings || [])
  .filter((f) => f.rule === rule)
  .map((f) => f.file);

// Un bloque lo bastante largo para que la etapa de duplicación lo cuente (mínimo 6 líneas
// significativas), y sin líneas que la gramática repite por su cuenta.
const BLOQUE = `export function total(items) {
  let suma = 0;
  for (const item of items) {
    suma = suma + item.precio * item.cantidad;
  }
  const impuesto = suma * 0.21;
  const envio = suma > 100 ? 0 : 5;
  return suma + impuesto + envio;
}
`;

test('the debt of the previous task does not come back in this task report', async () => {
  const dir = await project({
    '.chalc/gate.json': CONFIG,
    'specs/013-alcance/spec.md': '- **R1** — WHEN algo THE SYSTEM SHALL otra cosa.',
    'src/viejo.ts': 'export const viejo = () => { console.log("de la tarea anterior"); };\n'
  });
  await previousTaskClosed(dir);
  await writeFile(join(dir, 'src', 'nuevo.ts'), 'export const nuevo = () => { console.log("de hoy"); };\n', 'utf8');

  const result = await runGate({ root: dir, run, fast: true });

  assert.deepEqual(filesWith(result, RULES.debugOutput), ['src/nuevo.ts']);
});

// R11 — la asimetría de la spec 012 se conserva: leer todo, reportar solo lo de la tarea. Sin leer
// el árbol entero, la copia que más duele —la del bloque que ya existía en un archivo que no
// abriste— sería justo la que no se detecta.
test('duplication still reads the whole tree, but only reports what this task touched', async () => {
  const dir = await project({
    '.chalc/gate.json': CONFIG,
    'specs/013-alcance/spec.md': '- **R1** — WHEN algo THE SYSTEM SHALL otra cosa.',
    'src/viejo.ts': BLOQUE
  });
  await previousTaskClosed(dir);
  await writeFile(join(dir, 'src', 'nuevo.ts'), BLOQUE, 'utf8');

  const result = await runGate({ root: dir, run, fast: true });

  assert.deepEqual(filesWith(result, RULES.duplication), ['src/nuevo.ts'],
    'la copia se detecta contra un archivo que la tarea no abrió, y se reporta en el que sí');
});

test('duplication between two files of previous tasks stays out of this report', async () => {
  const dir = await project({
    '.chalc/gate.json': CONFIG,
    'specs/013-alcance/spec.md': '- **R1** — WHEN algo THE SYSTEM SHALL otra cosa.',
    'src/viejo-a.ts': BLOQUE,
    'src/viejo-b.ts': BLOQUE
  });
  await previousTaskClosed(dir);
  await writeFile(join(dir, 'src', 'nuevo.ts'), 'export const limpio = () => 1;\n', 'utf8');

  const result = await runGate({ root: dir, run, fast: true });

  assert.deepEqual(filesWith(result, RULES.duplication), [], 'deuda vieja entre archivos intactos');
});

// T10 (R7) de punta a punta: no basta con que la evidencia SEPA renderizar el alcance, tiene que
// recibirlo. Sin esto, el informe saldría diciendo "no se pudo determinar" en cada corrida buena.
test('the evidence the gate writes carries the real scope of the run', async () => {
  const dir = await project({
    '.chalc/gate.json': CONFIG,
    'specs/013-alcance/spec.md': '- **R1** — WHEN algo THE SYSTEM SHALL otra cosa.',
    'src/base.ts': 'export const base = () => 1;\n'
  });
  await previousTaskClosed(dir);
  await writeFile(join(dir, 'src', 'nuevo.ts'), 'export const n = 1;\n', 'utf8');

  await runGate({ root: dir, run, fast: true });
  const md = await readFile(join(dir, '.chalc', 'gate.md'), 'utf8');
  const state = JSON.parse(await readFile(join(dir, '.chalc', 'gate.state.json'), 'utf8'));

  assert.match(md, /src\/nuevo\.ts/, 'el informe dice qué archivo se revisó');
  assert.deepEqual(state.scope.files, ['src/nuevo.ts'], 'y el estado lo dice igual, para el advisor');
  assert.equal(state.scope.source, 'baseline');
});

// El ruido que se dejó fuera también llega al informe: es la línea que distingue "solo cambió un
// archivo" de "cambiaron veinte y diecinueve no eran míos".
test('the evidence declares the work in progress it left out', async () => {
  const dir = await project({
    '.chalc/gate.json': CONFIG,
    'specs/013-alcance/spec.md': '- **R1** — WHEN algo THE SYSTEM SHALL otra cosa.',
    'src/base.ts': 'export const base = () => 1;\n'
  });
  await previousTaskClosed(dir);
  await writeFile(join(dir, 'src', 'lo-mio.ts'), 'export const m = 1;\n', 'utf8');
  await writeFile(join(dir, 'src', 'ajeno.ts'), 'export const a = 1;\n', 'utf8');
  await writeFile(join(dir, '.chalc', 'task.files'), 'src/lo-mio.ts\n', 'utf8');

  await runGate({ root: dir, run, fast: true });
  const md = await readFile(join(dir, '.chalc', 'gate.md'), 'utf8');

  assert.match(md, /src\/ajeno\.ts/, 'lo excluido se nombra: nada se descarta en silencio');
});

// El registro manda sobre el diff también aquí: el archivo a medias de otra cosa está en el árbol,
// pero no es de esta tarea y sus problemas no son hallazgos de hoy.
test('work in progress from something else is not linted as part of this task', async () => {
  const dir = await project({
    '.chalc/gate.json': CONFIG,
    'specs/013-alcance/spec.md': '- **R1** — WHEN algo THE SYSTEM SHALL otra cosa.',
    'src/base.ts': 'export const base = () => 1;\n'
  });
  await previousTaskClosed(dir);
  await writeFile(join(dir, 'src', 'lo-mio.ts'), 'export const mio = () => 1;\n', 'utf8');
  await writeFile(join(dir, 'src', 'ajeno.ts'), 'export const ajeno = () => { console.log("a medias"); };\n', 'utf8');
  await writeFile(join(dir, '.chalc', 'task.files'), 'src/lo-mio.ts\n', 'utf8');

  const result = await runGate({ root: dir, run, fast: true });

  assert.deepEqual(filesWith(result, RULES.debugOutput), []);
});
