// T1 (spec 013, R1/R3) — la línea base de la tarea.
//
// Es el hecho del que cuelga todo el alcance: sin un punto de partida registrado, "los archivos de
// esta tarea" no se puede calcular y acaba siendo lo que el modelo interprete del diff. Por eso el
// módulo tiene la misma obligación que el resto de lectores del portón: no romperse nunca. Un
// `task.json` corrupto significa "no hay línea base" —y el alcance cae al respaldo declarado—, jamás
// una excepción que tumbe la corrida.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseBaseline, readBaseline, sealBaseline, TASK_REL } from '../catalog/gate/lib/baseline.mjs';

const project = () => mkdtemp(join(tmpdir(), 'chalc-gate-baseline-'));

// Escribe `.chalc/task.json` a mano, para ejercitar lecturas que `sealBaseline` nunca produciría.
async function withTaskFile(dir, text) {
  await mkdir(join(dir, '.chalc'), { recursive: true });
  await writeFile(join(dir, '.chalc', 'task.json'), text, 'utf8');
}

test('readBaseline reports no baseline when the file is missing', async () => {
  const baseline = await readBaseline(await project());

  assert.equal(baseline.exists, false);
  assert.equal(baseline.commit, '');
  assert.equal(baseline.date, 0);
});

// Un repo equipado con una versión anterior de chalc no tiene el archivo, y uno interrumpido a media
// escritura puede tenerlo a medias. Ninguno de los dos casos puede propagar una excepción: el portón
// cae al respaldo de R4 y lo dice en la evidencia.
test('readBaseline survives a corrupt file', async () => {
  const dir = await project();
  await withTaskFile(dir, '{ esto no es json');

  const baseline = await readBaseline(dir);

  assert.equal(baseline.exists, false);
});

// Un `commit` que no es un hexadecimal de git no se interpreta. Aceptarlo daría una referencia que
// `git diff` rechaza, y el alcance quedaría vacío — que R13 prohíbe confundir con "aprobado".
test('readBaseline rejects a baseline without a usable commit', async () => {
  const dir = await project();
  await withTaskFile(dir, JSON.stringify({ base: { commit: 'HEAD~1', date: '2026-08-11T09:00:00Z' } }));

  const baseline = await readBaseline(dir);

  assert.equal(baseline.exists, false);
});

// Un JSON válido que no trae `base` no es media línea base: es ninguna. Distinguirlo del corrupto
// importa porque llega por otra vía —una versión futura del archivo con otro esquema— y el defecto
// tiene que ser el mismo.
test('readBaseline rejects a file without a base block', async () => {
  const dir = await project();
  await withTaskFile(dir, JSON.stringify({ sealedBy: 'gate' }));

  const baseline = await readBaseline(dir);

  assert.equal(baseline.exists, false);
});

// `parseBaseline` es puro y se prueba directo: `readBaseline` lo envuelve en un try/catch que
// convertiría en "no hay base" hasta una excepción de programación. Un `base: null` explícito tiene
// que devolver NONE por decisión, no por rescate del envoltorio.
test('parseBaseline does not throw on a null base', () => {
  assert.equal(parseBaseline('{"base":null}').exists, false);
  assert.equal(parseBaseline('{"base":"a1b2c3d4e5"}').exists, false);
});

// Cuatro es el mínimo que git acepta como abreviatura. Por debajo no es un commit corto, es un
// hexadecimal cualquiera: pasarlo a `git diff` resolvería a otra cosa o a nada.
test('parseBaseline rejects a commit shorter than git abbreviates', () => {
  assert.equal(parseBaseline('{"base":{"commit":"a1b","date":"2026-08-11T09:00:00Z"}}').exists, false);
  assert.equal(parseBaseline('{"base":{"commit":"a1b2","date":"2026-08-11T09:00:00Z"}}').exists, true);
});

// Con commit bueno y fecha ilegible tampoco hay línea base: la fecha no es decorativa, es contra lo
// que el advisor mide la frescura. Una base sin fecha usable daría un "desde cuándo" inventado.
test('readBaseline rejects a baseline without a usable date', async () => {
  const dir = await project();
  await withTaskFile(dir, JSON.stringify({ base: { commit: 'a1b2c3d4e5', date: 'ayer' } }));

  const baseline = await readBaseline(dir);

  assert.equal(baseline.exists, false);
});

test('sealBaseline writes a baseline that readBaseline can read back', async () => {
  const dir = await project();

  await sealBaseline(dir, { commit: 'a1b2c3d4e5', date: new Date('2026-08-11T09:00:00Z') });
  const baseline = await readBaseline(dir);

  assert.equal(baseline.exists, true);
  assert.equal(baseline.commit, 'a1b2c3d4e5');
  assert.equal(baseline.date, Date.parse('2026-08-11T09:00:00Z'));
  assert.equal(baseline.sealedBy, 'gate');
});

// R3: la tarea sigue siendo la misma mientras no se cierre otra. Volver a sellar en el mismo commit
// —dos corridas seguidas del portón sin trabajo en medio— no puede mover la referencia ni refrescar
// la fecha: la frescura del advisor se mide contra ella, y moverla daría por nuevo lo que no lo es.
test('sealing again at the same commit keeps the original reference', async () => {
  const dir = await project();

  await sealBaseline(dir, { commit: 'a1b2c3d4e5', date: new Date('2026-08-11T09:00:00Z') });
  await sealBaseline(dir, { commit: 'a1b2c3d4e5', date: new Date('2026-08-11T18:30:00Z') });
  const baseline = await readBaseline(dir);

  assert.equal(baseline.date, Date.parse('2026-08-11T09:00:00Z'), 'la fecha del primer sello manda');
});

test('sealing at a new commit moves the reference', async () => {
  const dir = await project();

  await sealBaseline(dir, { commit: 'a1b2c3d4e5', date: new Date('2026-08-11T09:00:00Z') });
  await sealBaseline(dir, { commit: 'ffee00dd11', date: new Date('2026-08-12T09:00:00Z') });
  const baseline = await readBaseline(dir);

  assert.equal(baseline.commit, 'ffee00dd11');
  assert.equal(baseline.date, Date.parse('2026-08-12T09:00:00Z'));
});

// Sellar con algo que no es un commit no puede dejar rastro. Si se escribiera, `git diff` rechazaría
// la referencia en cada corrida y el alcance saldría vacío — que R13 prohíbe confundir con aprobado.
// Y peor: una base rota persistida es más difícil de detectar que la ausencia de base, que ya tiene
// respaldo declarado (R4).
test('sealBaseline refuses to seal something that is not a commit', async () => {
  const dir = await project();

  const sealed = await sealBaseline(dir, { commit: 'HEAD', date: new Date('2026-08-11T09:00:00Z') });

  assert.equal(sealed.exists, false);
  // Se comprueba el ARCHIVO, no lo que devuelve `readBaseline`: la guarda de lectura rechazaría esa
  // base igual, así que preguntarle a ella dejaría pasar un sello que sí escribió basura en disco.
  assert.equal(existsSync(join(dir, TASK_REL)), false, 'no se escribe una base inservible');
});

test('sealBaseline creates the chalc folder when it does not exist yet', async () => {
  const dir = await project();

  await sealBaseline(dir, { commit: 'a1b2c3d4e5', date: new Date('2026-08-11T09:00:00Z') });

  const raw = JSON.parse(await readFile(join(dir, '.chalc', 'task.json'), 'utf8'));
  assert.equal(raw.base.commit, 'a1b2c3d4e5');
});
