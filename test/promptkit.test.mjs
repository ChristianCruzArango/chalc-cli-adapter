// test/promptkit.test.mjs — specs/014-debate R10 (y D2: la generalización del parser).
//
// `parseSections` es el parser de respuestas por marcas `===SECCIÓN===` que ya usaba spec-ia, ahora
// con el juego de secciones como parámetro. El turno de un debate tiene otras secciones que una
// spec, pero el problema es el mismo: leer lo que el modelo devuelva SIN romperse — porque una
// respuesta truncada a mitad ya se pagó, y tirarla entera por una sección que falta es tirar tokens.

import test from 'node:test';
import assert from 'node:assert/strict';
import { inject, parseSections, unfence } from '../lib/promptkit.mjs';

const TURNO = `===POSTURA===
Sostengo el diseño con cola de eventos.

===DESACUERDOS===
- El coste de operación no está medido.

===ESTADO===
acuerdo: no`;

test('parseSections devuelve exactamente las secciones pedidas', () => {
  const s = parseSections(TURNO, ['POSTURA', 'DESACUERDOS', 'ESTADO']);
  assert.equal(s.POSTURA, 'Sostengo el diseño con cola de eventos.');
  assert.equal(s.DESACUERDOS, '- El coste de operación no está medido.');
  assert.equal(s.ESTADO, 'acuerdo: no');
});

test('una sección pedida que no vino es cadena vacía, no undefined ni excepción', () => {
  const s = parseSections(TURNO, ['POSTURA', 'PREGUNTAS_USUARIO']);
  assert.equal(s.PREGUNTAS_USUARIO, '');
});

test('una sección presente que no se pidió no se cuela en el resultado', () => {
  const s = parseSections(TURNO, ['POSTURA']);
  assert.deepEqual(Object.keys(s), ['POSTURA']);
});

test('respuesta truncada: conserva lo ya recibido en vez de perder el turno entero', () => {
  const truncada = '===POSTURA===\nla propuesta completa\n===DESACUER';
  const s = parseSections(truncada, ['POSTURA', 'DESACUERDOS']);
  assert.equal(s.POSTURA, 'la propuesta completa');
  assert.equal(s.DESACUERDOS, '');
});

test('quita el cercado ``` que el modelo a veces pone alrededor de una sección', () => {
  const s = parseSections('===POSTURA===\n```md\ncontenido\n```\n===ESTADO===\nacuerdo: si', ['POSTURA', 'ESTADO']);
  assert.equal(s.POSTURA, 'contenido');
  assert.equal(s.ESTADO, 'acuerdo: si');
});

test('acepta marcas con espacios y en minúsculas (===  postura  ===)', () => {
  const s = parseSections('===  postura  ===\nvale igual', ['POSTURA']);
  assert.equal(s.POSTURA, 'vale igual');
});

test('las secciones con guion bajo se leen y además cortan la anterior', () => {
  // PREGUNTAS_USUARIO no puede tragarse el texto de la siguiente marca por llevar '_'.
  const raw = '===PREGUNTAS_USUARIO===\n- ¿qué volumen?\n===ESTADO===\nacuerdo: no';
  const s = parseSections(raw, ['PREGUNTAS_USUARIO', 'ESTADO']);
  assert.equal(s.PREGUNTAS_USUARIO, '- ¿qué volumen?');
  assert.equal(s.ESTADO, 'acuerdo: no');
});

test('entrada vacía, nula o basura devuelve todas las secciones vacías sin lanzar', () => {
  for (const raw of ['', null, undefined, 'texto sin marcas']) {
    const s = parseSections(raw, ['POSTURA', 'ESTADO']);
    assert.equal(s.POSTURA, '');
    assert.equal(s.ESTADO, '');
  }
});

test('un nombre de sección con metacaracteres se rechaza en vez de corromper el patrón', () => {
  // Un nombre inyectado en una RegExp sin control es una expresión rota o un match imprevisto:
  // se falla al construir, que es cuando el bug es del programador y no del usuario.
  assert.throws(() => parseSections(TURNO, ['POST(URA']), /secci/i);
});

// ── lo que ya existía sigue igual ──────────────────────────────────────────────────────────────
test('inject exige que todas las variables de la plantilla estén resueltas', () => {
  assert.equal(inject('hola ${QUIEN}', { QUIEN: 'mundo' }), 'hola mundo');
  assert.throws(() => inject('hola ${QUIEN}', {}), /QUIEN/);
});

test('unfence quita el cercado envolvente y respeta el texto sin cercar', () => {
  assert.equal(unfence('```js\ncodigo\n```'), 'codigo');
  assert.equal(unfence('sin cercado'), 'sin cercado');
});

test('una palabra del cuerpo igual al nombre de otra sección NO se confunde con su marca', () => {
  // Bug real, encontrado al ratificar un informe: "===VEREDICTO===\ncorrecciones\n===CORRECCIONES==="
  // hacía que el parser tomara el `===` de cierre + la palabra suelta + el `===` de apertura como si
  // fueran la marca, y la sección salía empezando por "CORRECCIONES===".
  const raw = '===VEREDICTO===\ncorrecciones\n===CORRECCIONES===\n- lo primero\n- lo segundo';
  const s = parseSections(raw, ['VEREDICTO', 'CORRECCIONES']);

  assert.equal(s.VEREDICTO, 'correcciones');
  assert.equal(s.CORRECCIONES, '- lo primero\n- lo segundo');
});

test('la marca tiene que estar sola en su línea, no pegada a un texto', () => {
  const s = parseSections('hablamos de ===POSTURA=== en mitad de una frase\n===POSTURA===\nesta sí', ['POSTURA']);
  assert.equal(s.POSTURA, 'esta sí');
});
