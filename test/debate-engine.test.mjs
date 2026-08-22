// test/debate-engine.test.mjs — specs/014-debate R8, R11, R13–R16, R18, R28, R30.
//
// El motor no sabe que existe una IA: recibe `ask` y `askUser`. Todo el flujo —incluidos los cierres
// y el fallo de un proveedor a mitad— se prueba con turnos guionizados, sin red y sin gastar un token.

import test from 'node:test';
import assert from 'node:assert/strict';
import { plannedCalls, runDebate } from '../lib/debate/engine.mjs';

const participants = {
  a: { id: 'a', stance: 'proponent', model: 'modelo-a', provider: 'openrouter' },
  b: { id: 'b', stance: 'challenger', model: 'modelo-b', provider: 'openai' }
};

const turno = ({ postura = 'argumento', desacuerdos = [], resueltos = [], preguntas = [], acuerdo = false }) => [
  '===POSTURA===', postura,
  '===DESACUERDOS===', ...desacuerdos.map((d) => `- ${d}`),
  '===RESUELTOS===', ...resueltos.map((r) => `- ${r}`),
  '===PREGUNTAS_USUARIO===', ...preguntas.map((p) => `- ${p}`),
  '===ESTADO===', `acuerdo: ${acuerdo ? 'si' : 'no'}`
].join('\n');

// `ask` guionizado: registra cada petición y responde según el guion (por índice de llamada).
function scripted(responses) {
  const calls = [];
  const ask = async (req) => {
    calls.push(req);
    const r = responses[calls.length - 1];
    if (r instanceof Error) throw r;
    return typeof r === 'function' ? r(req) : (r ?? turno({}));
  };
  return { ask, calls };
}

const base = { idea: 'una cola de eventos para el checkout', participants, rounds: 3 };

// ── T7 · posturas y alternancia ────────────────────────────────────────────────────────────────
test('la ronda de aclaración pregunta a los DOS y luego alterna quién abre cada ronda (R8, R14)', async () => {
  const { ask, calls } = scripted([]);
  await runDebate({ ...base, ask, askUser: async () => [] });

  const clarify = calls.filter((c) => c.kind === 'clarify').map((c) => c.participant.id);
  assert.deepEqual(clarify, ['a', 'b']);   // los dos leen la idea antes de discutir

  const turnos = calls.filter((c) => c.kind === 'turn').map((c) => `${c.round}${c.participant.id}`);
  assert.deepEqual(turnos, ['1a', '1b', '2b', '2a', '3a', '3b']);   // R14: nadie cierra siempre
});

// ── T8 · los dos cierres ───────────────────────────────────────────────────────────────────────
test('aunque los dos declaren acuerdo desde el primer turno, no se cierra en la ronda 1 (R11)', async () => {
  const conforme = turno({ acuerdo: true, postura: 'me parece perfecto' });
  const { ask, calls } = scripted([conforme, conforme, conforme, conforme, conforme, conforme, conforme, conforme]);
  const state = await runDebate({ ...base, ask, askUser: async () => [] });

  // Nadie objetó nada en todo el debate: eso no es consenso, es complacencia. No cierra por acuerdo.
  assert.equal(state.closedBy, 'limit');
  assert.equal(calls.filter((c) => c.kind === 'turn').length, 6);
});

test('con desacuerdo real y acuerdo justificado por los dos, cierra antes de gastar las rondas (R13)', async () => {
  const { ask, calls } = scripted([
    turno({}), turno({}),                                                          // aclaración
    turno({ postura: 'propongo la cola' }),                                        // 1a
    turno({ desacuerdos: ['el coste de operación no está medido'] }),              // 1b
    turno({ acuerdo: true, resueltos: ['D1: el coste queda acotado por el plan de autoscaling que acordamos'] }),   // 2b… (abre b)
    turno({ acuerdo: true, resueltos: ['D1: el coste queda acotado por el plan de autoscaling que acordamos'] })    // 2a
  ]);
  const state = await runDebate({ ...base, ask, askUser: async () => [] });

  assert.equal(state.closedBy, 'agreement');
  assert.equal(calls.filter((c) => c.kind === 'turn').length, 4);   // se ahorró la ronda 3
});

test('un acuerdo SIN justificar no cierra: el debate sigue hasta el tope (R12, R16)', async () => {
  const { ask } = scripted([
    turno({}), turno({}),
    turno({ postura: 'propongo la cola' }),
    turno({ desacuerdos: ['el coste de operación no está medido'] }),
    turno({ acuerdo: true }),                       // "de acuerdo" a secas: no cuenta
    turno({ acuerdo: true })
  ]);
  const state = await runDebate({ ...base, ask, askUser: async () => [] });

  assert.equal(state.closedBy, 'limit');
  assert.equal(state.desacuerdosAbiertos.length, 1);   // el desacuerdo sigue vivo, no se maquilla
});

// ── T9 · el tope ───────────────────────────────────────────────────────────────────────────────
test('agotado el tope sin acuerdo, cierra por límite y conserva los desacuerdos abiertos (R16)', async () => {
  const { ask } = scripted([
    turno({}), turno({}),
    turno({ postura: 'propongo la cola' }),
    turno({ desacuerdos: ['no hay plan de reproceso', 'el coste no está medido'] })
  ]);
  const state = await runDebate({ ...base, rounds: 1, ask, askUser: async () => [] });

  assert.equal(state.closedBy, 'limit');
  assert.equal(state.rounds, 1);
  assert.deepEqual(state.desacuerdosAbiertos.map((d) => d.n), [1, 2]);
  assert.match(state.desacuerdosAbiertos[0].texto, /reproceso/);
});

test('un tope menor que 1 se rechaza antes de gastar una sola llamada (R15)', async () => {
  const { ask, calls } = scripted([]);
  for (const rounds of [0, -1, 'dos', null]) {
    await assert.rejects(() => runDebate({ ...base, rounds, ask, askUser: async () => [] }), /rounds/i);
  }
  assert.equal(calls.length, 0);
});

// ── T10 · las preguntas al usuario ─────────────────────────────────────────────────────────────
test('las preguntas de aclaración se fusionan y se hacen ANTES de la primera ronda (R17)', async () => {
  const pregunta = turno({ preguntas: ['¿Qué volumen diario esperas?'] });
  const { ask, calls } = scripted([pregunta, pregunta]);
  const preguntadas = [];
  const askUser = async (qs) => {
    preguntadas.push({ tras: calls.length, ids: qs.map((q) => q.id) });
    return qs.map((q) => ({ id: q.id, respuesta: '10k al día' }));
  };
  const state = await runDebate({ ...base, rounds: 1, ask, askUser });

  assert.equal(preguntadas[0].tras, 2);            // justo después de la aclaración, antes de debatir
  assert.deepEqual(preguntadas[0].ids, ['q1']);    // una sola pregunta: la fusionaron
  assert.equal(state.questions[0].respuesta, '10k al día');
  assert.deepEqual(state.questions[0].pedidaPor, ['a', 'b']);
});

test('una pregunta levantada a mitad del debate se traslada al usuario y su respuesta llega a los DOS (R18)', async () => {
  const { ask, calls } = scripted([
    turno({}), turno({}),
    turno({ preguntas: ['¿el checkout es síncrono?'] }),   // 1a pregunta a mitad
    turno({ desacuerdos: ['falta el plan de reproceso'] })
  ]);
  const askUser = async (qs) => qs.map((q) => ({ id: q.id, respuesta: 'es asíncrono' }));
  const state = await runDebate({ ...base, rounds: 1, ask, askUser });

  assert.equal(state.questions.length, 1);
  assert.equal(state.questions[0].respondida, true);
  // el turno siguiente (1b) ya recibió el estado con la respuesta dentro
  const turnoB = calls.find((c) => c.kind === 'turn' && c.participant.id === 'b');
  assert.equal(turnoB.state.questions[0].respuesta, 'es asíncrono');
});

test('sin askUser (no interactivo) las preguntas quedan sin responder y el debate NO se bloquea (R20)', async () => {
  const { ask } = scripted([turno({ preguntas: ['¿volumen?'] }), turno({})]);
  const state = await runDebate({ ...base, rounds: 1, ask });

  assert.equal(state.questions.length, 1);
  assert.equal(state.questions[0].respondida, false);
  assert.equal(state.closedBy, 'limit');
});

// ── T11 · coste y fallo ────────────────────────────────────────────────────────────────────────
test('el coste previsto es exacto: aclaración + rondas + acta + ratificación (R28, R46)', () => {
  assert.equal(plannedCalls({ rounds: 3 }), 11);                // 2 + 6 + acta + ratificar y reescribir
  assert.equal(plannedCalls({ rounds: 1 }), 7);
  assert.equal(plannedCalls({ rounds: 3, judge: true }), 13);   // el juez evalúa en los dos órdenes
});

test('si un proveedor se cae a mitad, se conserva lo ya pagado y se dice dónde falló (R30)', async () => {
  const { ask } = scripted([
    turno({}), turno({}),
    turno({ postura: 'propongo la cola' }),
    new Error('API 503: upstream unavailable')
  ]);
  const state = await runDebate({ ...base, ask, askUser: async () => [] });

  assert.equal(state.closedBy, 'error');
  assert.equal(state.turns.length, 1);                    // el turno ya pagado no se tira
  assert.equal(state.error.round, 1);
  assert.equal(state.error.by, 'b');
  assert.match(state.error.message, /503/);
  assert.equal(state.synthesis, '');                      // no se paga un acta de un debate roto
});

test('el acta se pide una vez, al final, con el debate entero (R21)', async () => {
  const { ask, calls } = scripted([]);
  const state = await runDebate({ ...base, rounds: 1, ask, askUser: async () => [] });

  const actas = calls.filter((c) => c.kind === 'synthesis');
  assert.equal(actas.length, 1);
  assert.equal(actas[0].state.turns.length, 2);
  assert.equal(state.synthesis, actas[0] ? state.synthesis : '');
  assert.ok(state.synthesis.length > 0);
});

// ── refuerzo tras la pasada de mutantes (T22) ──────────────────────────────────────────────────
// Los dos tests de abajo nacieron de mutantes que SOBREVIVIERON: el tope de turnos de R11 estaba
// cubierto solo de refilón (por la regla de "nadie objetó") y la deduplicación de desacuerdos no lo
// estaba en absoluto. Un mutante vivo es un bug que nadie atrapa.

test('el acuerdo justificado desde el primer turno tampoco cierra dentro de la ronda 1 (R11)', async () => {
  // Aquí SÍ hubo disenso real, así que lo único que impide cerrar en la ronda 1 es el tope de turnos:
  // la propuesta tiene que volver a pasar por su autor antes de dar nada por acordado.
  // El disenso lo levanta el retador: el turno de apertura ya no abre desacuerdos (R38), así que la
  // objeción entra en el segundo turno y el cierre sigue necesitando el tercero.
  const { ask } = scripted([
    turno({}), turno({}),
    turno({ postura: 'propongo la cola', acuerdo: true }),                                                     // 1a
    turno({ desacuerdos: ['el reproceso no está definido'], acuerdo: true }),                                  // 1b
    turno({ acuerdo: true, resueltos: ['D1: el reproceso queda cubierto por la cola de mensajes muertos'] })    // 2b
  ]);
  const state = await runDebate({ ...base, rounds: 2, ask, askUser: async () => [] });

  assert.equal(state.turns.length, 3);        // hizo falta el tercer turno: no se cerró con dos
  assert.equal(state.closedBy, 'agreement');
});

test('la misma objeción repetida ronda tras ronda es UN desacuerdo, no varios', async () => {
  const objecion = 'el coste de operación no está medido';
  const { ask } = scripted([
    turno({}), turno({}),
    turno({ postura: 'propongo la cola' }),                    // 1a
    turno({ desacuerdos: [objecion] }),                        // 1b
    turno({ desacuerdos: [`${objecion} todavía`] }),           // 2b: la misma, con otras palabras
    turno({})
  ]);
  const state = await runDebate({ ...base, rounds: 2, ask, askUser: async () => [] });

  assert.equal(state.desacuerdosAbiertos.length, 1);
  assert.equal(state.raisedTotal, 1);   // y el informe no dirá que hubo dos objeciones distintas
});

// ── T24/T25 · coste acotado (R33, R34, R37) ────────────────────────────────────────────────────

test('sin nadie que responda, la ronda de aclaración no se paga (R34)', async () => {
  const { ask, calls } = scripted([]);
  const state = await runDebate({ ...base, rounds: 1, clarify: false, ask });

  assert.equal(calls.filter((c) => c.kind === 'clarify').length, 0);
  assert.equal(calls.length, 4);          // 2 turnos + acta + ratificación, ni una llamada más
  assert.deepEqual(state.questions, []);
});

test('el coste previsto refleja lo que de verdad se va a gastar (R37)', () => {
  assert.equal(plannedCalls({ rounds: 3 }), 11);                                  // con aclaración
  assert.equal(plannedCalls({ rounds: 3, clarify: false }), 9);                   // sin ella
  assert.equal(plannedCalls({ rounds: 3, clarify: false, brief: true }), 10);     // + comprimir la idea
  assert.equal(plannedCalls({ rounds: 2, clarify: false, judge: true }), 9);
});

test('al agotarse el presupuesto se cierra entre turnos y NO se paga el acta (R33)', async () => {
  const { ask, calls } = scripted([]);
  let turnos = 0;
  // El freno mira el gasto real; aquí se simula que se pasa tras el segundo turno.
  const shouldStop = () => { turnos = calls.filter((c) => c.kind === 'turn').length; return turnos >= 2; };
  const state = await runDebate({ ...base, rounds: 3, clarify: false, ask, shouldStop });

  assert.equal(state.closedBy, 'budget');
  assert.equal(state.turns.length, 2);
  assert.equal(calls.filter((c) => c.kind === 'synthesis').length, 0);   // la llamada más cara no se paga
  assert.equal(state.synthesis, '');
});

test('un presupuesto que nunca se supera no cambia nada (R33)', async () => {
  const { ask } = scripted([]);
  const state = await runDebate({ ...base, rounds: 1, clarify: false, ask, shouldStop: () => false });

  assert.equal(state.closedBy, 'limit');
  assert.ok(state.synthesis.length > 0);
});

test('el presupuesto se comprueba ANTES de la primera llamada: agotado, no se gasta nada (R33)', async () => {
  // Con la ronda de aclaración ACTIVA: si el freno solo mirase después de ella, un presupuesto ya
  // agotado se llevaría por delante dos llamadas antes de darse cuenta. (Mutante que sobrevivió a la
  // primera pasada porque el caso se probaba solo con `clarify: false`.)
  for (const clarify of [true, false]) {
    const { ask, calls } = scripted([]);
    const state = await runDebate({ ...base, rounds: 3, clarify, ask, askUser: async () => [], shouldStop: () => true });

    assert.equal(state.closedBy, 'budget');
    assert.equal(calls.length, 0, `con clarify=${clarify} no debería gastarse ninguna llamada`);
  }
});

test('la idea comprimida viaja en los turnos y el texto íntegro se conserva aparte (R35)', async () => {
  const { ask, calls } = scripted([]);
  const state = await runDebate({ ...base, idea: 'resumen corto', ideaFull: 'EL DOCUMENTO ENTERO', rounds: 1, clarify: false, ask });

  assert.equal(calls[0].state.idea, 'resumen corto');       // lo que ve el debate
  assert.equal(calls[0].state.ideaFull, 'EL DOCUMENTO ENTERO');   // lo que conserva el informe
  assert.equal(state.ideaFull, 'EL DOCUMENTO ENTERO');
});

// ── ratificación del informe (R46, R47, R48) ───────────────────────────────────────────────────
// "Los dos están de acuerdo con el informe" es una afirmación fuerte. Hasta aquí el acta la escribía
// un modelo y el otro no la veía nunca: el que la firma tiene que haberla leído.

const acta = (texto = 'el acta') => `===PROPUESTA===\n${texto}\n===PROXIMOS_PASOS===\n- empezar`;
const ratifica = (veredicto, correcciones = []) =>
  ['===VEREDICTO===', veredicto, '===CORRECCIONES===', ...correcciones.map((c) => `- ${c}`)].join('\n');

test('el informe lo ratifica el lado que NO lo escribió (R46)', async () => {
  const { ask, calls } = scripted([turno({}), turno({}), acta('v1'), ratifica('conforme')]);
  const state = await runDebate({ ...base, rounds: 1, clarify: false, ask, rapporteur: 'a' });

  const rat = calls.find((c) => c.kind === 'ratify');
  assert.equal(rat.participant.id, 'b');            // lo revisa el otro, no el autor
  assert.equal(state.ratification.veredicto, 'conforme');
  assert.equal(state.ratification.correcciones.length, 0);
  assert.equal(state.synthesis, acta('v1'));        // conforme: no se reescribe nada
});

test('con correcciones, el acta se reescribe incorporándolas antes de entregarla (R46)', async () => {
  const { ask, calls } = scripted([
    turno({}), turno({}),
    acta('v1'),
    ratifica('correcciones', ['dice que se acordó el escrow y no se acordó', 'falta el cupo mínimo']),
    acta('v2 corregida')
  ]);
  const state = await runDebate({ ...base, rounds: 1, clarify: false, ask, rapporteur: 'a' });

  const rewrite = calls.find((c) => c.kind === 'rewrite');
  assert.equal(rewrite.correcciones.length, 2);
  assert.equal(state.synthesis, acta('v2 corregida'));      // se entrega la corregida
  assert.equal(state.ratification.veredicto, 'correcciones');
  assert.equal(state.ratification.aplicadas, true);
});

test('una ratificación ilegible no se cuenta como conforme (R47)', async () => {
  const { ask } = scripted([turno({}), turno({}), acta(), 'me parece bien todo']);
  const state = await runDebate({ ...base, rounds: 1, clarify: false, ask, rapporteur: 'a' });

  assert.equal(state.ratification.veredicto, '');
  assert.equal(state.ratification.conforme, false);   // ante la duda, NO está ratificado
});

test('sin presupuesto para ratificar, el informe se entrega SIN ratificar (R48)', async () => {
  let llamadas = 0;
  const { ask } = scripted([turno({}), turno({}), acta()]);
  const contando = async (req) => { llamadas += 1; return ask(req); };
  const state = await runDebate({
    ...base, rounds: 1, clarify: false, ask: contando, rapporteur: 'a',
    shouldStop: () => llamadas >= 3      // se agota justo después del acta
  });

  assert.equal(state.ratification, null);
  assert.ok(state.synthesis.length > 0);   // pero el acta pagada se entrega igual
});

test('si la ratificación falla, no se pierde el informe ya pagado (R48, R30)', async () => {
  const { ask } = scripted([turno({}), turno({}), acta(), new Error('API 503')]);
  const state = await runDebate({ ...base, rounds: 1, clarify: false, ask, rapporteur: 'a' });

  assert.ok(state.synthesis.length > 0);
  assert.equal(state.ratification?.conforme, false);
  assert.match(state.ratification.error, /503/);
});

test('el coste anunciado incluye la ratificación y su posible reescritura (R48)', () => {
  assert.equal(plannedCalls({ rounds: 2, clarify: false }), 7);   // 4 turnos + acta + ratificación + reescritura
  assert.equal(plannedCalls({ rounds: 3 }), 11);                  // + las 2 de aclaración
});
