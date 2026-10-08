// spec 015 · T3, T4 (R4–R7) — la memoria se ordena por concepto, no por palabra.
//
// «money», «plata», «moneda» y «tarifa» son el mismo concepto: dinero. Si la memoria guardara por
// palabra, una regla aprendida con «monto» no le llegaría a una spec que habla de «tarifas», que es
// justo el caso que hay que cubrir.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { conceptsIn, learnSynonym, listConcepts, loadConcepts, normalize } from '../catalog/memory/lib/concepts.mjs';

const repo = () => mkdtemp(join(tmpdir(), 'chalc-concepts-'));

test('R4: the base dictionary brings the frequent concepts with synonyms in both languages', async () => {
  const concepts = await loadConcepts(await repo());
  for (const id of ['dinero', 'fechas', 'identidad', 'autenticacion', 'autorizacion', 'datos-personales', 'archivos', 'red', 'almacenamiento']) {
    assert.ok(concepts[id]?.synonyms?.length >= 4, id);
  }
  assert.ok(concepts.dinero.synonyms.includes('money'));
  assert.ok(concepts.dinero.synonyms.includes('plata'));
});

test('R5: any synonym, in any language, leads to its concept', async () => {
  const concepts = await loadConcepts(await repo());
  for (const text of ['Cobrar en pesos', 'convertir la moneda', 'calcular las tarifas de envío', 'Show the price', 'the plata balance', 'Total amount due']) {
    assert.deepEqual(conceptsIn(text, concepts), ['dinero'], text);
  }
});

test('R5: case, accents and plural do not matter', async () => {
  assert.equal(normalize('Contraseñas'), 'contrasena');
  assert.equal(normalize('FECHAS'), 'fecha');
  assert.equal(normalize('Teléfonos'), 'telefono');
  assert.equal(normalize('prices'), 'price');
  assert.equal(normalize('status'), 'status');
});

test('R5: a text can touch several concepts, and unrelated words touch none', async () => {
  const concepts = await loadConcepts(await repo());
  assert.deepEqual(conceptsIn('El usuario inicia sesión y paga con tarjeta', concepts), ['autenticacion', 'dinero', 'identidad']);
  assert.deepEqual(conceptsIn('Mostrar el logo animado en la portada', concepts), []);
});

// ── T4 (R6, R7) ───────────────────────────────────────────────────────────────────────────────

test('R6: a synonym the dictionary did not know is learned in the repo, and found next time', async () => {
  const root = await repo();
  assert.deepEqual(conceptsIn('liquidar la comisión', await loadConcepts(root)), []);

  await learnSynonym(root, 'dinero', 'Comisiones');
  assert.deepEqual(conceptsIn('liquidar la comisión', await loadConcepts(root)), ['dinero']);

  const learned = JSON.parse(await readFile(join(root, '.chalc/memory/concepts.json'), 'utf8'));
  assert.deepEqual(learned, { dinero: { synonyms: ['comision'] } });
});

test('R6: learning a known synonym writes nothing, and a new concept can be created', async () => {
  const root = await repo();
  assert.equal(await learnSynonym(root, 'dinero', 'money'), false);
  assert.equal(await learnSynonym(root, 'envios', 'despacho'), true);
  assert.deepEqual(conceptsIn('programar el despacho', await loadConcepts(root)), ['envios']);
});

test('R7: the concept list is one short line per concept, sorted', async () => {
  const lines = listConcepts(await loadConcepts(await repo()));
  assert.ok(lines.length >= 9);
  assert.deepEqual([...lines].sort(), lines);
  const money = lines.find((l) => l.startsWith('dinero'));
  assert.match(money, /^dinero — .*money/);
  assert.ok(money.length <= 100, 'una línea corta, no el diccionario entero');
});

// Una palabra que significa cosas distintas según el contexto no entra al diccionario: en Flutter
// `Card` es un widget, `path` y `ruta` son navegación, `table` y `alert` son componentes de interfaz.
// Con ellas, cualquier pantalla parecería tocar dinero, archivos o almacenamiento.
test('R5: ambiguous interface words do not trigger a concept', async () => {
  const concepts = await loadConcepts(await repo());
  for (const text of ['el peso del paquete en gramos', 'Card(child: Text(title))', 'go to the settings path', 'la ruta del menú', 'render a table of rows', 'show an alert dialog', 'Total due']) {
    assert.deepEqual(conceptsIn(text, concepts), [], text);
  }
  assert.deepEqual(conceptsIn('pagar con tarjeta de crédito', concepts), ['dinero']);
});

// La lista es para que una persona o un modelo elija: muestra las palabras como se escriben, no la
// forma normalizada con la que se compara («base de datos», no «base de dato»).
test('R7: the concept list shows the words as written, not their normalized form', async () => {
  const lines = listConcepts(await loadConcepts(await repo()));
  assert.match(lines.find((l) => l.startsWith('almacenamiento')), /base de datos/);
  assert.match(lines.find((l) => l.startsWith('datos-personales')), /teléfono|telefono/);
});


// ── bordes de la lectura de palabras ──────────────────────────────────────────────────────────

test('R5: plural endings follow the same rules for the dictionary and the text', () => {
  assert.equal(normalize('comisiones'), 'comision');
  assert.equal(normalize('roles'), 'rol');
  assert.equal(normalize('ales'), 'ale');
  assert.equal(normalize('gas'), 'gas');
  assert.equal(normalize('pdfs'), 'pdf');
  assert.equal(normalize(undefined), '');
});

test('R5: code identifiers are split into words, and multi-word synonyms must be adjacent', async () => {
  const concepts = await loadConcepts(await repo());
  assert.deepEqual(conceptsIn('const unitPrice = 2', concepts), ['dinero']);
  assert.deepEqual(conceptsIn('guardar en la base de datos', concepts), ['almacenamiento']);
  assert.deepEqual(conceptsIn('la base y los datos', concepts), []);
});

// Encontrado en la prueba de punta a punta: un rol propuso «pesos» como sinónimo de dinero, y es
// justo una palabra que el diccionario deja fuera por ambigua (también es el peso de un paquete).
// Lo que el diccionario declara ambiguo no se aprende, lo proponga quien lo proponga.
test('R6: a word the dictionary marks as ambiguous is never learned as a synonym', async () => {
  const root = await repo();
  for (const word of ['pesos', 'Card', 'path', 'ruta', 'tabla', 'alerta']) {
    assert.equal(await learnSynonym(root, 'dinero', word), false, word);
  }
  assert.deepEqual(conceptsIn('el peso del paquete', await loadConcepts(root)), []);
});

test('R7: the ambiguous list is not a concept', async () => {
  const concepts = await loadConcepts(await repo());
  assert.ok(!Object.keys(concepts).some((id) => id.startsWith('_')));
  assert.ok(!listConcepts(concepts).some((line) => line.startsWith('_')));
});

// Un repo que ya había aprendido una palabra ambigua antes de que existiera la lista deja de usarla
// sin tener que editar su archivo.
test('R6: an ambiguous word already learned by a repo is ignored when loading', async () => {
  const root = await repo();
  await mkdir(join(root, '.chalc', 'memory'), { recursive: true });
  await writeFile(join(root, '.chalc/memory/concepts.json'), JSON.stringify({ dinero: { synonyms: ['peso', 'comision'] } }));

  const concepts = await loadConcepts(root);
  assert.deepEqual(conceptsIn('el peso del paquete', concepts), []);
  assert.deepEqual(conceptsIn('la comisión', concepts), ['dinero']);
});
