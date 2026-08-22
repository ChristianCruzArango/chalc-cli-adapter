// test/debate-judge.test.mjs — specs/014-debate R22 (el dictamen opcional).
//
// Un juez LLM elige la respuesta que le presentan PRIMERO en torno al 68 % de las veces, y pedirle
// que "no se fije en el orden" apenas baja ese sesgo. La mitigación que sí funciona es estructural:
// preguntar dos veces con las posturas intercambiadas. Si el veredicto cambia al invertirlas, el
// juez no estaba juzgando el argumento — estaba juzgando la posición. Eso es un empate, y decide
// el usuario.

import test from 'node:test';
import assert from 'node:assert/strict';
import { judge } from '../lib/debate/judge.mjs';

const state = {
  idea: 'una cola de eventos para el checkout',
  turns: [
    { round: 1, by: 'a', postura: 'la cola desacopla el pico', raw: '===POSTURA===\nla cola desacopla el pico', acuerdos: [], desacuerdos: [], resueltos: [], preguntas: [] },
    { round: 1, by: 'b', postura: 'el coste operativo no está medido', raw: '===POSTURA===\nel coste operativo no está medido', acuerdos: [], desacuerdos: ['el coste no está medido'], resueltos: [], preguntas: [] }
  ],
  desacuerdosAbiertos: [{ n: 1, texto: 'el coste de operación no está medido', by: 'b', round: 1 }],
  desacuerdosResueltos: [],
  questions: []
};

const dictamen = (posicion, porque = 'porque el argumento se apoya en datos y el otro no') =>
  `===VEREDICTO===\n${posicion}\n===PORQUE===\n${porque}`;

test('veredicto estable en los dos órdenes: hay ganador (R22)', async () => {
  // Pasada 1 → A es la Postura 1 y gana. Pasada 2 (invertida) → A es la Postura 2 y vuelve a ganar.
  const calls = [];
  const ask = async (req) => { calls.push(req); return dictamen(calls.length === 1 ? '1' : '2'); };
  const r = await judge({ state, ask, lang: 'es' });

  assert.equal(calls.length, 2);                 // siempre dos: es el precio de no tener sesgo de posición
  assert.equal(r.ganador, 'a');
  assert.equal(r.empate, false);
});

test('veredicto que cambia al invertir el orden: empate, no ganador (R22)', async () => {
  // Las dos veces elige "la primera que le enseñaron": eso es sesgo de posición, no un juicio.
  const ask = async () => dictamen('1');
  const r = await judge({ state, ask, lang: 'es' });

  assert.equal(r.empate, true);
  assert.equal(r.ganador, '');
  assert.equal(r.pasadas.length, 2);             // las dos quedan registradas para poder auditarlo
});

test('el juez que declara empate explícitamente se respeta (R22)', async () => {
  const ask = async () => dictamen('empate', 'las dos posturas se sostienen con la información disponible');
  const r = await judge({ state, ask, lang: 'es' });

  assert.equal(r.empate, true);
  assert.equal(r.ganador, '');
});

test('un veredicto ilegible no inventa ganador: empate (R22)', async () => {
  const ask = async () => 'no me ha quedado claro';
  const r = await judge({ state, ask, lang: 'es' });
  assert.equal(r.empate, true);
});

test('el juez ve las posturas anónimas y en el orden que le toca (R22, R9)', async () => {
  const vistos = [];
  const ask = async (req) => { vistos.push(req.user); return dictamen('1'); };
  await judge({ state, ask, lang: 'es' });

  const [primera, segunda] = vistos;
  // Postura 1 y Postura 2 se intercambian entre pasadas…
  assert.ok(primera.indexOf('la cola desacopla el pico') < primera.indexOf('el coste operativo no está medido'));
  assert.ok(segunda.indexOf('el coste operativo no está medido') < segunda.indexOf('la cola desacopla el pico'));
  // …y en ninguna aparece quién es quién
  for (const v of vistos) {
    assert.equal(/proponent|challenger|participante a|participante b/i.test(v), false);
  }
});

test('sin desacuerdos abiertos no hay nada que dictaminar y no se gasta ninguna llamada (R22)', async () => {
  let llamadas = 0;
  const ask = async () => { llamadas += 1; return dictamen('1'); };
  const r = await judge({ state: { ...state, desacuerdosAbiertos: [] }, ask, lang: 'es' });

  assert.equal(llamadas, 0);
  assert.equal(r, null);
});
