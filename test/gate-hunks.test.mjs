// Las LÍNEAS que la tarea cambió, no solo los archivos.
//
// El portón acotaba a los archivos tocados, pero medía cada archivo entero. Añadir dos líneas a uno
// de cuatrocientas metía en la revisión los cientos de hallazgos y mutantes que ya estaban ahí: en
// una feature real, 132 de 139 mutantes supervivientes eran de código que la tarea no escribió. Con
// ese ruido el portón no puede pasar en ningún repo con historia, y empuja a escribir pruebas de
// relleno sobre código ajeno para subir un número.

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHunks, touchesChange, relativeTo, removedByFile, rangesOf } from '../catalog/gate/lib/hunks.mjs';

const diff = (...lines) => lines.join('\n');

test('parseHunks lists the lines added to a file', async () => {
  const mapa = parseHunks(diff(
    '+++ b/src/precio.ts',
    '@@ -10,0 +11,3 @@',
    '+const a = 1;',
    '+const b = 2;',
    '+const c = 3;'
  ));

  assert.deepEqual([...mapa.get('src/precio.ts')], [11, 12, 13]);
});

test('parseHunks handles a single-line hunk without a count', async () => {
  const mapa = parseHunks(diff('+++ b/src/precio.ts', '@@ -4 +7 @@', '+const a = 1;'));

  assert.deepEqual([...mapa.get('src/precio.ts')], [7]);
});

test('parseHunks keeps every file of the diff apart', async () => {
  const mapa = parseHunks(diff(
    '+++ b/src/a.ts',
    '@@ -0,0 +1,1 @@',
    '+const a = 1;',
    '+++ b/src/b.ts',
    '@@ -0,0 +5,2 @@',
    '+const b = 2;'
  ));

  assert.deepEqual([...mapa.get('src/a.ts')], [1]);
  assert.deepEqual([...mapa.get('src/b.ts')], [5, 6]);
});

// Un bloque borrado no deja líneas nuevas que revisar: `+0,0` no aporta ninguna.
test('parseHunks records no line for a pure deletion', async () => {
  const mapa = parseHunks(diff('+++ b/src/precio.ts', '@@ -10,3 +9,0 @@', '-const a = 1;'));

  assert.equal(mapa.get('src/precio.ts')?.size ?? 0, 0);
});

// El reporte de mutación de .NET nombra los archivos con contrabarra; el diff, con barra. Sin
// normalizar al consultar, ningún mutante casaría con su archivo y se aceptarían todos.
test('touchesChange normalises the separators of the file it is asked about', async () => {
  const mapa = new Map([['src/precio.ts', new Set([10])]]);

  assert.equal(touchesChange(mapa, 'src\\precio.ts', 10), true);
  assert.equal(touchesChange(mapa, 'src\\precio.ts', 40), false);
});

// ── a quién pertenece un hallazgo ─────────────────────────────────────────────────────────────

test('touchesChange accepts a finding on a line the task wrote', async () => {
  const mapa = new Map([['src/precio.ts', new Set([10, 11])]]);

  assert.equal(touchesChange(mapa, 'src/precio.ts', 10), true);
});

test('touchesChange rejects a finding on a line the task never touched', async () => {
  const mapa = new Map([['src/precio.ts', new Set([10, 11])]]);

  assert.equal(touchesChange(mapa, 'src/precio.ts', 40), false);
});

// Una función larga es de la tarea si la tarea escribió dentro, aunque su cabecera sea vieja: quien
// añadió las líneas que la pasaron del límite es quien la dejó así.
test('touchesChange accepts a span that contains a written line', async () => {
  const mapa = new Map([['src/precio.ts', new Set([25])]]);

  assert.equal(touchesChange(mapa, 'src/precio.ts', 10, 30), true);
});

test('touchesChange rejects a span with nothing written inside', async () => {
  const mapa = new Map([['src/precio.ts', new Set([80])]]);

  assert.equal(touchesChange(mapa, 'src/precio.ts', 10, 30), false);
});

// Sin información de líneas no se puede atribuir nada, y callar hallazgos por no saber sería peor
// que enseñarlos de más: el portón enseña todo lo del archivo.
test('touchesChange accepts everything when the file has no line information', async () => {
  assert.equal(touchesChange(new Map(), 'src/nuevo.ts', 999), true);
  assert.equal(touchesChange(null, 'src/nuevo.ts', 999), true);
});

// ── rutas del reporte de mutación ─────────────────────────────────────────────────────────────
//
// Stryker.NET nombra los archivos con su ruta ABSOLUTA y con contrabarra; el diff los nombra
// relativos al repo y con barra. Sin traducir, ningún mutante casaría con su archivo y el alcance
// por línea no filtraría nada.

test('relativeTo turns an absolute report path into a repo path', async () => {
  assert.equal(
    relativeTo('D:/repo', 'D:\\repo\\src\\Domain\\Precio.cs'),
    'src/Domain/Precio.cs'
  );
});

test('relativeTo leaves a path that is already relative alone', async () => {
  assert.equal(relativeTo('D:/repo', 'src/Domain/Precio.cs'), 'src/Domain/Precio.cs');
});

test('relativeTo ignores case in the root, as Windows does', async () => {
  assert.equal(relativeTo('D:/Repo', 'd:/repo/src/a.ts'), 'src/a.ts');
});

// ── cuántas líneas se fueron ──────────────────────────────────────────────────────────────────
//
// Para saber si un archivo YA pasaba del límite antes de la tarea hace falta su tamaño anterior, y
// eso son las líneas de hoy menos las que se añadieron MÁS las que se borraron. Sin las borradas,
// un archivo de 301 líneas al que se le cambia una por tres parece que medía 300 —justo el límite—
// y la deuda vieja se le cobra a quien pasaba por ahí.

test('removedByFile counts the lines a hunk took away', async () => {
  const mapa = removedByFile(diff('+++ b/src/precio.ts', '@@ -10,4 +10,1 @@', '-uno', '-dos', '-tres', '+nuevo'));

  assert.equal(mapa.get('src/precio.ts'), 4);
});

test('removedByFile counts a single removed line without a count', async () => {
  const mapa = removedByFile(diff('+++ b/src/precio.ts', '@@ -10 +9,0 @@', '-uno'));

  assert.equal(mapa.get('src/precio.ts'), 1);
});

test('removedByFile adds up every hunk of the same file', async () => {
  const mapa = removedByFile(diff(
    '+++ b/src/precio.ts',
    '@@ -10,2 +10,0 @@', '-uno', '-dos',
    '@@ -30,3 +28,0 @@', '-tres', '-cuatro', '-cinco'
  ));

  assert.equal(mapa.get('src/precio.ts'), 5);
});

test('removedByFile reports nothing for a pure addition', async () => {
  const mapa = removedByFile(diff('+++ b/src/precio.ts', '@@ -10,0 +11,2 @@', '+uno', '+dos'));

  assert.equal(mapa.get('src/precio.ts') ?? 0, 0);
});

// ── rangos contiguos ──────────────────────────────────────────────────────────────────────────
//
// Stryker sabe mutar tramos concretos de un archivo (`Archivo.cs{44..46}` en .NET, `a.ts:44-46` en
// JS). Para aprovecharlo hay que convertir las líneas sueltas de la tarea en tramos.

test('rangesOf turns consecutive lines into one range', async () => {
  assert.deepEqual(rangesOf(new Set([10, 11, 12])), [[10, 12]]);
});

test('rangesOf keeps separate runs apart', async () => {
  assert.deepEqual(rangesOf(new Set([10, 11, 40])), [[10, 11], [40, 40]]);
});

test('rangesOf sorts numerically, not as text', async () => {
  assert.deepEqual(rangesOf(new Set([9, 10, 100])), [[9, 10], [100, 100]]);
});

test('rangesOf returns nothing for an empty set', async () => {
  assert.deepEqual(rangesOf(new Set()), []);
  assert.deepEqual(rangesOf(null), []);
});

// Tramos separados por un hueco diminuto se funden: mide unas pocas líneas de más, pero evita que
// el comando crezca sin control. Errar hacia medir de MÁS es el lado seguro.
test('rangesOf merges runs separated by a tiny gap', async () => {
  assert.deepEqual(rangesOf(new Set([10, 11, 13, 14]), { gap: 2 }), [[10, 14]]);
});

test('rangesOf does not merge across a wide gap', async () => {
  assert.deepEqual(rangesOf(new Set([10, 40]), { gap: 2 }), [[10, 10], [40, 40]]);
});
