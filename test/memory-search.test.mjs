// spec 015 · Tm (R20) — cómo se ordena una búsqueda a mano.
//
// El concepto pesa más que la palabra, las palabras cortas no cuentan, y se busca en el título, el
// detalle y los archivos. Con empate, gana la entrada vista más veces.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConcepts } from '../catalog/memory/lib/concepts.mjs';
import { search } from '../catalog/memory/lib/search.mjs';

const concepts = await loadConcepts(await mkdtemp(join(tmpdir(), 'chalc-search-')));
const e = (id, over = {}) => ({ id, kind: 'rule', concepts: [], title: '', seen: 1, ...over });
const ids = (list) => list.map((x) => x.id);

test('R20: an entry matching more query words ranks first', () => {
  const list = [e('una', { title: 'validar el correo' }), e('dos', { title: 'validar el correo del cliente' })];
  assert.deepEqual(ids(search(list, 'validar correo cliente', concepts)), ['dos', 'una']);
});

test('R20: sharing the concept outweighs sharing one word', () => {
  const list = [e('palabra', { title: 'calcular el total' }), e('concepto', { concepts: ['dinero'], title: 'otra cosa' })];
  assert.deepEqual(ids(search(list, 'calcular tarifas', concepts)), ['concepto', 'palabra']);
});

test('R20: the detail and the files are searched too, and missing ones do not break it', () => {
  const list = [
    e('detalle', { title: 'una regla', detail: 'redondear antes de enviar' }),
    e('archivo', { title: 'otra regla', files: ['src/redondeo.mjs'] }),
    e('vacio', { title: 'nada que ver' })
  ];
  assert.deepEqual(ids(search(list, 'redondear', concepts)), ['detalle']);
  assert.deepEqual(ids(search(list, 'redondeo', concepts)), ['archivo']);
});

test('R20: words of two letters or less do not count', () => {
  assert.deepEqual(search([e('corta', { title: 'de la regla' })], 'de la', concepts), []);
});

test('R20: a tie is broken by how many times the entry was seen', () => {
  const list = [e('poco', { title: 'regla del monto', seen: 1 }), e('mucho', { title: 'regla del monto', seen: 4 }), e('nunca', { title: 'regla del monto', seen: undefined })];
  assert.deepEqual(ids(search(list, 'regla', concepts)), ['mucho', 'poco', 'nunca']);
});

test('R20: the limit is honored, by default and when given', () => {
  const list = Array.from({ length: 12 }, (_, i) => e(`r${i}`, { title: 'regla común' }));
  assert.equal(search(list, 'regla', concepts).length, 8);
  assert.equal(search(list, 'regla', concepts, { limit: 3 }).length, 3);
});
