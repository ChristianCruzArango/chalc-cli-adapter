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
    { round: 1, by: 'a', position: 'la cola desacopla el pico', raw: '===POSTURA===\nla cola desacopla el pico', agreements: [], disagreements: [], settled: [], raisedQuestions: [] },
    { round: 1, by: 'b', position: 'el coste operativo no está medido', raw: '===POSTURA===\nel coste operativo no está medido', agreements: [], disagreements: ['el coste no está medido'], settled: [], raisedQuestions: [] }
  ],
  openDisagreements: [{ n: 1, text: 'el coste de operación no está medido', by: 'b', round: 1 }],
  settledDisagreements: [],
  questions: []
};

const dictamen = (posicion, why = 'porque el argumento se apoya en datos y el otro no') =>
  `===VEREDICTO===\n${posicion}\n===PORQUE===\n${why}`;

test('veredicto estable en los dos órdenes: hay ganador (R22)', async () => {
  // Pasada 1 → A es la Postura 1 y gana. Pasada 2 (invertida) → A es la Postura 2 y vuelve a ganar.
  const calls = [];
  const ask = async (req) => { calls.push(req); return dictamen(calls.length === 1 ? '1' : '2'); };
  const r = await judge({ state, ask, lang: 'es' });

  assert.equal(calls.length, 2);                 // siempre dos: es el precio de no tener sesgo de posición
  assert.equal(r.winner, 'a');
  assert.equal(r.tie, false);
});

test('veredicto que cambia al invertir el orden: empate, no ganador (R22)', async () => {
  // Las dos veces elige "la primera que le enseñaron": eso es sesgo de posición, no un juicio.
  const ask = async () => dictamen('1');
  const r = await judge({ state, ask, lang: 'es' });

  assert.equal(r.tie, true);
  assert.equal(r.winner, '');
  assert.equal(r.past.length, 2);             // las dos quedan registradas para poder auditarlo
});

test('el juez que declara empate explícitamente se respeta (R22)', async () => {
  const ask = async () => dictamen('empate', 'las dos posturas se sostienen con la información disponible');
  const r = await judge({ state, ask, lang: 'es' });

  assert.equal(r.tie, true);
  assert.equal(r.winner, '');
});

test('un veredicto ilegible no inventa ganador: empate (R22)', async () => {
  const ask = async () => 'no me ha quedado claro';
  const r = await judge({ state, ask, lang: 'es' });
  assert.equal(r.tie, true);
});

test('el juez ve las posturas anónimas y en el orden que le toca (R22, R9)', async () => {
  const vistos = [];
  const ask = async (req) => { vistos.push(req.user); return dictamen('1'); };
  await judge({ state, ask, lang: 'es' });

  const [first, second] = vistos;
  // Postura 1 y Postura 2 se intercambian entre pasadas…
  assert.ok(first.indexOf('la cola desacopla el pico') < first.indexOf('el coste operativo no está medido'));
  assert.ok(second.indexOf('el coste operativo no está medido') < second.indexOf('la cola desacopla el pico'));
  // …y en ninguna aparece quién es quién
  for (const v of vistos) {
    assert.equal(/proponent|challenger|participante a|participante b/i.test(v), false);
  }
});

test('sin desacuerdos abiertos no hay nada que dictaminar y no se gasta ninguna llamada (R22)', async () => {
  let llamadas = 0;
  const ask = async () => { llamadas += 1; return dictamen('1'); };
  const r = await judge({ state: { ...state, openDisagreements: [] }, ask, lang: 'es' });

  assert.equal(llamadas, 0);
  assert.equal(r, null);
});
