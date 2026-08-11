// T15 (spec 013, R10b) — que un asistente externo deje el mismo rastro que el harness propio.
//
// El registro de rutas escritas es la fuente precisa del alcance, y hasta ahora solo sabía llenarlo
// el harness de chalc. Con Claude Code o Codex al volante no había registro, así que el alcance caía
// al diff — y en un flujo donde se commitea al final, el diff no separa una tarea de la anterior.
//
// La pieza es deliberadamente tonta: un anotador que recibe el evento de un hook y apunta la ruta.
// Nada de decidir; decidir es de `scope.mjs`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { pathsIn, recordEvent } from '../catalog/gate/record.mjs';
import { readTouched, TOUCHED_REL } from '../catalog/gate/lib/touched.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HOOKS = join(ROOT, 'catalog', 'hooks');
const RECORDER = join(ROOT, 'catalog', 'gate', 'record.mjs');

const project = () => mkdtemp(join(tmpdir(), 'chalc-record-'));

// La forma que manda Claude Code en un hook PostToolUse.
const event = (tool, input) => JSON.stringify({ tool_name: tool, tool_input: input });

test('a write event yields the path it wrote', () => {
  assert.deepEqual(pathsIn(event('Write', { file_path: '/repo/src/pago.ts', content: 'x' })), ['/repo/src/pago.ts']);
});

// Cada herramienta nombra su parámetro a su manera y no hay un estándar entre asistentes. Aceptar
// las formas conocidas es más barato que un anotador por target — y más honesto que fingir que solo
// existe uno.
test('the usual shapes of a path are all understood', () => {
  assert.deepEqual(pathsIn(event('Edit', { path: 'src/a.ts' })), ['src/a.ts']);
  assert.deepEqual(pathsIn(event('write_file', { filePath: 'src/b.ts' })), ['src/b.ts']);
});

// Leer un archivo no es escribirlo. Si el anotador apuntara las lecturas, el alcance incluiría todo
// lo que el asistente miró de pasada — que es medio repo, y el problema de vuelta.
test('an event that wrote nothing yields nothing', () => {
  assert.deepEqual(pathsIn(event('Read', { file_path: '/repo/src/pago.ts' })), []);
  assert.deepEqual(pathsIn(event('Bash', { command: 'ls' })), []);
});

// Un evento ilegible no puede tumbar el turno del asistente: el hook corre dentro de su ciclo.
test('an unreadable event yields nothing instead of throwing', () => {
  assert.deepEqual(pathsIn('{ esto no es json'), []);
  assert.deepEqual(pathsIn(''), []);
});

// ── lo que acaba en el registro ───────────────────────────────────────────────────────────────

test('recordEvent writes the path into the task record, relative to the project', async () => {
  const dir = await project();

  await recordEvent(dir, { stdin: event('Write', { file_path: join(dir, 'src', 'pago.ts') }) });

  assert.deepEqual((await readTouched(dir)).files, ['src/pago.ts']);
});

// Un asistente puede escribir fuera del repo —su propia config, un temporal—. Eso no es trabajo de
// esta tarea y no puede entrar en el alcance: el portón solo sabe revisar dentro del proyecto.
test('a path outside the project never enters the record', async () => {
  const dir = await project();

  await recordEvent(dir, { stdin: event('Write', { file_path: join(tmpdir(), 'fuera', 'otro.ts') }) });

  assert.equal(existsSync(join(dir, TOUCHED_REL)), false);
});

// La puerta para lo que no sea un hook con JSON: pasar las rutas como argumentos. Un target que no
// pueda dar el evento entero puede al menos dar la ruta.
test('paths can also arrive as plain arguments', async () => {
  const dir = await project();

  await recordEvent(dir, { argv: ['src/uno.ts', 'src/dos.ts'] });

  assert.deepEqual((await readTouched(dir)).files, ['src/dos.ts', 'src/uno.ts']);
});

test('an event about something that is not source is not recorded', async () => {
  const dir = await project();

  await recordEvent(dir, { stdin: event('Write', { file_path: join(dir, 'README.md') }) });

  assert.equal(existsSync(join(dir, TOUCHED_REL)), false);
});

// ── el anotador como proceso ──────────────────────────────────────────────────────────────────
//
// Encontrado equipando un repo de verdad: con las rutas por argumento, el anotador se quedaba
// esperando a que alguien cerrara la entrada estándar. Nadie la cerraba —no había nada que mandar
// por ahí— y el proceso no terminaba nunca.
//
// Es el peor fallo posible para un hook: no falla, se cuelga, y con él el turno del asistente. Y no
// se veía en las pruebas de la función porque solo aparece cuando corre como proceso de verdad.
test('given paths as arguments, the recorder does not wait for standard input', async () => {
  const dir = await project();

  const finished = await new Promise((resolve) => {
    // stdin queda ABIERTO a propósito: es la situación exacta que colgaba.
    const child = spawn(process.execPath, [RECORDER, 'src/pago.ts'], { cwd: dir, stdio: ['pipe', 'ignore', 'ignore'] });
    const timer = setTimeout(() => { child.kill(); resolve(false); }, 5000);
    child.on('close', () => { clearTimeout(timer); resolve(true); });
    child.on('error', () => { clearTimeout(timer); resolve(false); });
  });

  assert.equal(finished, true, 'el anotador tiene que terminar solo');
  assert.deepEqual((await readTouched(dir)).files, ['src/pago.ts']);
});

// ── el hook documentado ───────────────────────────────────────────────────────────────────────
//
// El anotador solo sirve si alguien lo engancha, y chalc no puede engancharlo por nadie: un hook se
// ejecuta solo y `.claude/settings.json` va commiteado (spec 007, R19). Así que la documentación es
// la entrega, y tiene que traer el bloque exacto y decir qué se pierde si no se pega.

test('the documented hook explains how to wire the recorder, in both languages', async () => {
  for (const file of ['gate-hook.md', 'gate-hook.en.md']) {
    const doc = await readFile(join(HOOKS, file), 'utf8');

    assert.match(doc, /node \.chalc\/gate\/record\.mjs/, `${file}: falta el comando del anotador`);
    assert.match(doc, /PostToolUse/, `${file}: falta el evento al que engancharlo`);
    assert.match(doc, /Write\|Edit/, `${file}: falta el filtro de herramientas que escriben`);
  }
});

// Sin esto, quien no pegue el hook creería que su portón está midiendo lo mismo. Lo que cambia es el
// alcance, que es justo lo que no se ve en un informe verde.
test('the documented hook says what is lost by not wiring it', async () => {
  for (const file of ['gate-hook.md', 'gate-hook.en.md']) {
    const doc = await readFile(join(HOOKS, file), 'utf8');

    assert.match(doc, /task\.files/, `${file}: no dice dónde se anota`);
    assert.match(doc, /diff/i, `${file}: no explica a qué se cae sin el hook`);
  }
});
