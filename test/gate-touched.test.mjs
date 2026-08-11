// T2 (spec 013, R10) — el registro de rutas que la tarea escribió.
//
// Es la fuente que el diff no puede dar: distingue "lo que hice en esta tarea" de "lo que había
// suelto en el árbol". El harness local ya lo sabe por sus tools de escritura y los targets externos
// lo anotarán por hook (R10b); aquí solo se define el formato y sus dos trampas — que se pise lo
// anterior, y que un registro viejo infle el alcance de la tarea siguiente.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, stat, utimes, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { clearTouched, readTouched, recordTouched, TOUCHED_REL } from '../catalog/gate/lib/touched.mjs';

const project = () => mkdtemp(join(tmpdir(), 'chalc-gate-touched-'));

test('readTouched reports nothing when there is no registry', async () => {
  const { files, stale } = await readTouched(await project());

  assert.deepEqual(files, []);
  assert.equal(stale, false, 'no tener registro no es tenerlo obsoleto');
});

test('recordTouched creates the registry and readTouched reads it back', async () => {
  const dir = await project();

  await recordTouched(dir, ['src/pago.service.ts', 'src/pago.model.ts']);

  assert.deepEqual((await readTouched(dir)).files, ['src/pago.model.ts', 'src/pago.service.ts']);
});

// Append-only y no al revés: el coder escribe en varios turnos, y una escritura que pisara la
// anterior dejaría fuera del alcance justo los archivos del principio de la tarea.
test('recordTouched appends without overwriting earlier entries', async () => {
  const dir = await project();

  await recordTouched(dir, ['src/pago.service.ts']);
  await recordTouched(dir, ['src/pago.model.ts']);

  assert.deepEqual((await readTouched(dir)).files, ['src/pago.model.ts', 'src/pago.service.ts']);
});

// El mismo archivo tocado cinco veces es un archivo, y en Windows llega con barras invertidas: el
// alcance no puede depender del separador con el que lo anotó quien escribió.
test('readTouched deduplicates and normalises separators', async () => {
  const dir = await project();

  await recordTouched(dir, ['src\\pago.service.ts', 'src/pago.service.ts', 'src/pago.service.ts']);

  assert.deepEqual((await readTouched(dir)).files, ['src/pago.service.ts']);
});

// El caso real: el mismo archivo tocado en dos turnos distintos. Cada anotación se hace por separado
// y ninguna ve a la otra —son procesos distintos, y por eso el formato es append-only—, así que la
// única deduplicación que cuenta es la del LECTOR. Sin ella el alcance repetiría archivos y el
// revisor los recibiría dos veces.
test('readTouched deduplicates across separate recordings', async () => {
  const dir = await project();

  await recordTouched(dir, ['src/pago.service.ts']);
  await recordTouched(dir, ['src/pago.service.ts', 'src/pago.model.ts']);

  assert.deepEqual((await readTouched(dir)).files, ['src/pago.model.ts', 'src/pago.service.ts']);
});

test('recordTouched ignores empty entries', async () => {
  const dir = await project();

  await recordTouched(dir, ['', '   ', 'src/pago.service.ts']);

  assert.deepEqual((await readTouched(dir)).files, ['src/pago.service.ts']);
});

// La trampa que más caro sale: si el portón sella una línea base nueva y el registro no se vacía, la
// tarea siguiente hereda los archivos de la anterior y el alcance crece tarea a tarea hasta volver a
// ser el de la rama — que es el problema que esta spec vino a arreglar.
test('a registry older than the baseline is ignored, and says so', async () => {
  const dir = await project();
  await recordTouched(dir, ['src/viejo.ts']);
  const old = new Date('2026-08-01T09:00:00Z');
  await utimes(join(dir, TOUCHED_REL), old, old);

  const { files, stale } = await readTouched(dir, { since: Date.parse('2026-08-11T09:00:00Z') });

  assert.deepEqual(files, [], 'lo de la tarea anterior no entra');
  assert.equal(stale, true, 'y no se calla: la evidencia tiene que poder declararlo');
});

// El caso que destapó una corrida real: la línea base se sella y el coder escribe acto seguido. La
// fecha de un archivo no tiene la resolución de `Date.now()` —según el sistema de archivos puede ir
// redondeada al segundo—, así que un registro escrito DESPUÉS del sello puede tener un `mtime`
// anterior a él y pasar por obsoleto. El efecto era el peor posible: el alcance caía al diff sin que
// nadie lo notara, y volvía a colarse el trabajo ajeno del árbol.
//
// Por eso el margen. Lo que de verdad limpia el registro al cerrar tarea es `clearTouched`; esta
// comprobación es una red por si aquello falló, y una red no puede disparar por milisegundos.
test('a registry written right at the baseline instant is not stale', async () => {
  const dir = await project();
  await recordTouched(dir, ['src/nuevo.ts']);
  const { mtimeMs } = await stat(join(dir, TOUCHED_REL));

  const { files, stale } = await readTouched(dir, { since: mtimeMs + 1000 });

  assert.deepEqual(files, ['src/nuevo.ts']);
  assert.equal(stale, false);
});

test('a registry clearly older than the baseline is still stale', async () => {
  const dir = await project();
  await recordTouched(dir, ['src/viejo.ts']);
  const { mtimeMs } = await stat(join(dir, TOUCHED_REL));

  assert.equal((await readTouched(dir, { since: mtimeMs + 60000 })).stale, true);
});

test('a registry written after the baseline counts', async () => {
  const dir = await project();
  await recordTouched(dir, ['src/nuevo.ts']);

  const { files, stale } = await readTouched(dir, { since: Date.parse('2026-08-01T09:00:00Z') });

  assert.deepEqual(files, ['src/nuevo.ts']);
  assert.equal(stale, false);
});

test('clearTouched empties the registry', async () => {
  const dir = await project();
  await recordTouched(dir, ['src/pago.service.ts']);

  await clearTouched(dir);

  assert.deepEqual((await readTouched(dir)).files, []);
});

test('clearTouched works when there is nothing to clear', async () => {
  const dir = await project();

  await clearTouched(dir);

  assert.equal(existsSync(join(dir, TOUCHED_REL)), false);
});

// Un registro ilegible es "no hay registro", no una corrida caída: el alcance cae al respaldo de R2
// y la evidencia lo dice. Misma regla que el resto de lectores del portón.
test('readTouched survives an unreadable registry', async () => {
  const dir = await project();
  await mkdir(join(dir, TOUCHED_REL), { recursive: true });   // una CARPETA donde debería ir el archivo

  const { files } = await readTouched(dir);

  assert.deepEqual(files, []);
});

test('recordTouched with nothing to record leaves no registry behind', async () => {
  const dir = await project();

  await recordTouched(dir, []);

  assert.equal(existsSync(join(dir, TOUCHED_REL)), false);
});

test('recordTouched tolerates a missing chalc folder and a missing list', async () => {
  const dir = await project();
  await writeFile(join(dir, 'x.txt'), 'x', 'utf8');

  await recordTouched(dir);

  assert.equal(existsSync(join(dir, TOUCHED_REL)), false);
});
