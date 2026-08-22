// test/debate-disagreements.test.mjs — specs/014-debate R38, R39, R40.
//
// Los textos de este archivo NO son inventados: salen de la primera corrida real del comando (Opus
// 4.8 contra GPT-5.5 sobre una app de canchas de fútbol, dos rondas). Aquel informe declaró 15
// desacuerdos abiertos donde había unos seis, y los tres fallos que lo causaron son los que se fijan
// aquí. Un test escrito desde el fallo real vale más que uno escrito desde el fallo imaginado.

import test from 'node:test';
import assert from 'node:assert/strict';
import { runDebate } from '../lib/debate/engine.mjs';
import { sameText } from '../lib/debate/text.mjs';
import { splitRef } from '../lib/debate/turn.mjs';

// ── los turnos tal y como llegaron ─────────────────────────────────────────────────────────────
const TESIS_DEL_PROPONENTE = [
  'El valor central está en el pago dividido entre desconocidos, no en la reserva simple, que es fácilmente replicable y sufre bypass.',
  'El lanzamiento debe ser geográfico-denso (una zona saturada), no amplio; la liquidez es local, no nacional.',
  'La comisión sola no basta como defensa contra bypass sin retener la transacción en la app.'
];

const OBJECIONES_RONDA_1 = [
  'D1: Si la app no resuelve pago dividido, no-shows y confianza, el valor central queda incompleto y la reserva simple no sostiene el negocio.',
  'D2: Un lanzamiento amplio diluiría oferta y demanda; con baja densidad por zona, las reservas abiertas fallan y dañan retención.',
  'D3: La comisión por reserva no evita bypass si dueño y jugador pueden coordinar por fuera después del primer contacto.'
];

// Las mismas de la ronda 1, renumeradas y reescritas: esto es lo que infló el informe real.
const LAS_MISMAS_RONDA_2 = [
  'D2: Sin densidad local por cancha, zona y franja horaria, las reservas abiertas fallarán por falta de liquidez y dañarán la retención.',
  'D3: El bypass sigue abierto en reservas simples y grupos recurrentes si dueño y jugador pueden coordinar fuera tras el primer contacto.'
];

const participants = {
  a: { id: 'a', stance: 'proponent', model: 'm-a', provider: 'p1' },
  b: { id: 'b', stance: 'challenger', model: 'm-b', provider: 'p2' }
};

const turno = (desacuerdos = [], postura = 'argumento') => [
  '===POSTURA===', postura,
  '===DESACUERDOS===', ...desacuerdos.map((d) => `- ${d}`),
  '===ESTADO===', 'acuerdo: no'
].join('\n');

function scripted(responses) {
  let n = 0;
  return { ask: async () => responses[n++] ?? turno() };
}

const base = { idea: 'una app para reservar canchas', participants, clarify: false };

// ── T29 · el turno de apertura no abre desacuerdos (R38) ───────────────────────────────────────
test('las tesis del que abre el debate NO son desacuerdos: todavía no hay contra quién (R38)', async () => {
  const { ask } = scripted([turno(TESIS_DEL_PROPONENTE), turno()]);
  const state = await runDebate({ ...base, rounds: 1, ask });

  assert.equal(state.desacuerdosAbiertos.length, 0);
  assert.equal(state.raisedTotal, 0);
  assert.ok(state.turns[0].desacuerdos.length > 0);   // su argumento no se pierde: sigue en el turno
});

test('a partir del segundo turno sí se abren: ahí ya hay postura ajena (R38)', async () => {
  const { ask } = scripted([turno(TESIS_DEL_PROPONENTE), turno(['la unidad económica no está probada'])]);
  const state = await runDebate({ ...base, rounds: 1, ask });

  assert.equal(state.desacuerdosAbiertos.length, 1);
  assert.equal(state.desacuerdosAbiertos[0].by, 'b');
});

// ── T30 · el prefijo D<n>: (R39) ───────────────────────────────────────────────────────────────
test('splitRef separa la referencia del texto, y no toca lo que no la lleva (R39)', () => {
  assert.deepEqual(splitRef('D2: un lanzamiento amplio diluiría la oferta'), { ref: 2, texto: 'un lanzamiento amplio diluiría la oferta' });
  assert.deepEqual(splitRef('D 12 . otra forma de escribirlo'), { ref: 12, texto: 'otra forma de escribirlo' });
  assert.deepEqual(splitRef('la comisión no basta'), { ref: null, texto: 'la comisión no basta' });
  assert.deepEqual(splitRef('D2C es un formato de datos'), { ref: null, texto: 'D2C es un formato de datos' });
});

test('el prefijo nunca llega al informe: se registra el texto limpio (R39)', async () => {
  const { ask } = scripted([turno(), turno(OBJECIONES_RONDA_1)]);
  const state = await runDebate({ ...base, rounds: 1, ask });

  assert.equal(state.desacuerdosAbiertos.length, 3);
  for (const d of state.desacuerdosAbiertos) assert.equal(/^D\s*\d+/.test(d.texto), false, `quedó el prefijo: ${d.texto}`);
  assert.match(state.desacuerdosAbiertos[0].texto, /^Si la app no resuelve/);
});

test('citar el PROPIO desacuerdo abierto es repetirse: no abre otro (R39)', async () => {
  // Exactamente lo que pasó en la corrida real: en la ronda 2 el retador volvió a numerar sus mismas
  // objeciones y el informe las contó dos veces.
  const { ask } = scripted([turno(), turno(OBJECIONES_RONDA_1), turno(LAS_MISMAS_RONDA_2), turno()]);
  const state = await runDebate({ ...base, rounds: 2, ask });

  assert.equal(state.desacuerdosAbiertos.length, 3);
});

test('citar el desacuerdo del RIVAL es rebatirlo: eso sí es una objeción nueva (R39)', async () => {
  const { ask } = scripted([
    turno(),                                                                         // 1a abre: no registra
    turno(['la unidad económica del negocio no está probada con números']),          // 1b → D1
    turno(['D1: el ticket medio de una cancha cubre de sobra la comisión objetivo']), // 2b: su propio D1 → reformula
    turno(['D1: los números de la zona piloto ya cubren la comisión y eso zanja la cuenta unitaria']) // 2a: el del rival → rebate
  ]);
  const state = await runDebate({ ...base, rounds: 2, ask });

  assert.equal(state.desacuerdosAbiertos.length, 2);
  assert.equal(state.desacuerdosAbiertos[1].by, 'a');
  assert.equal(/^D\s*\d+/.test(state.desacuerdosAbiertos[1].texto), false);
});

// ── T31 · la reescritura sin número (R40) ──────────────────────────────────────────────────────
test('la misma objeción reescrita con otras palabras es la misma (R40)', () => {
  const antes = 'La unidad económica es incierta: pagos, fraude, chargebacks, soporte y adquisición local pueden comerse una comisión baja.';
  const despues = 'La unidad económica es incierta; pasarela, fraude, chargebacks, soporte y CAC local pueden comerse una comisión baja.';
  assert.equal(sameText(antes, despues), true);
});

test('dos objeciones sobre cosas distintas NO se fusionan (R40)', () => {
  const bypass = 'El bypass sigue abierto en reservas simples si dueño y jugador coordinan por fuera tras el primer contacto.';
  const economia = 'La unidad económica es incierta: pasarela, fraude y soporte pueden comerse una comisión baja.';
  const disponibilidad = 'La disponibilidad real no está resuelta si las canchas siguen usando WhatsApp en paralelo.';

  assert.equal(sameText(bypass, economia), false);
  assert.equal(sameText(bypass, disponibilidad), false);
  assert.equal(sameText(economia, disponibilidad), false);
});

test('dos frases cortas no se fusionan por compartir palabras vacías (R40)', () => {
  assert.equal(sameText('el coste no está medido', 'el equipo no está formado'), false);
});

test('con poquísimas palabras con peso, coincidir en una no es coincidir (R40)', () => {
  // "sin liquidez" comparte su única palabra con peso con "liquidez local muy alta": el solape sale
  // del 100 % y las dos frases no dicen lo mismo. Por eso hace falta un mínimo de palabras.
  assert.equal(sameText('sin liquidez', 'liquidez local muy alta'), false);
});
