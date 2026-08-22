// test/debate-report.test.mjs — specs/014-debate R21, R24, R25, R30.
//
// El informe es el entregable: lo que queda cuando la terminal se cierra. Dos cosas se comprueban con
// especial saña — que los desacuerdos abiertos aparecen CON las dos posturas (nunca promediados), y
// que un debate roto a mitad produce igualmente un informe con lo ya pagado.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRecord, renderDebateLog, renderInforme } from '../lib/debate/report.mjs';

const turn = (round, by, postura, extra = {}) => ({
  round, by, stance: by === 'a' ? 'proponent' : 'challenger',
  postura, acuerdos: [], desacuerdos: [], resueltos: [], preguntas: [],
  declaraAcuerdo: false, acuerdoJustificado: false, raw: `===POSTURA===\n${postura}`, ...extra
});

const state = {
  idea: 'una cola de eventos para el checkout',
  participants: {
    a: { id: 'a', stance: 'proponent', model: 'anthropic/claude-opus-4.8', provider: 'openrouter' },
    b: { id: 'b', stance: 'challenger', model: 'gpt-oss:20b', provider: 'ollama' }
  },
  rounds: 3,
  roundsRun: 2,
  turns: [turn(1, 'a', 'ARGUMENTO DE A'), turn(1, 'b', 'ARGUMENTO DE B'), turn(2, 'b', 'REPLICA DE B'), turn(2, 'a', 'REPLICA DE A')],
  questions: [
    { id: 'q1', texto: '¿qué volumen diario?', pedidaPor: ['a', 'b'], respuesta: '10k al día', respondida: true },
    { id: 'q2', texto: '¿qué presupuesto?', pedidaPor: ['b'], respuesta: '', respondida: false }
  ],
  desacuerdosAbiertos: [{ n: 2, texto: 'el coste de operación no está medido', by: 'b', round: 1 }],
  desacuerdosResueltos: [{ n: 1, texto: 'la latencia se dispara', by: 'b', round: 1, resueltoEn: 2, resueltoPor: 'a', porque: 'el pico se absorbe en la cola' }],
  raisedTotal: 2,
  closedBy: 'limit',
  error: null,
  synthesis: [
    '===PROPUESTA===',
    '### Qué es',
    'Un checkout que publica el pedido en una cola y responde sin esperar a facturación.',
    '### Reglas fijadas',
    'Reintentos con backoff y cola de mensajes muertos.',
    '[PENDIENTE: cuánto cuesta operar la cola al mes — el lado 1 lo da por asumible, el lado 2 dice que nadie lo midió]',
    '===RESUMEN===', 'Se debatió una cola de eventos.',
    '===ACUERDOS===',
    '### Desacoplar el checkout de la facturación',
    'Qué se acordó: el checkout deja de esperar a facturación; se usa cola con reintentos.',
    'Lo que aportó el lado 1: propuso la cola y el esquema de reintentos.',
    'Lo que aportó el lado 2: aceptó el desacople y exigió reglas de reproceso.',
    'Qué implica: hay que operar un componente más.',
    '===RIESGOS===', '- Mensajes muertos sin reproceso.',
    '===PROXIMOS_PASOS===', '- Medir el coste un mes.'
  ].join('\n'),
  judgment: null,
  warnings: []
};

const meta = { generatedAt: '2026-08-22T10:00:00.000Z' };

test('el informe lleva las siete partes que exige la spec (R24)', () => {
  const md = renderInforme(state, meta);
  for (const trozo of [
    'una cola de eventos para el checkout',        // la idea
    'anthropic/claude-opus-4.8', 'openrouter',     // quién debatió, con proveedor
    'gpt-oss:20b', 'ollama',
    'cola con reintentos',                         // el acuerdo, explicado
    'Lo que aportó el lado 1',                     // y con lo que puso cada lado
    'PENDIENTE',                                   // lo no cerrado, dentro de la propuesta
    'Mensajes muertos sin reproceso',              // riesgos
    '¿qué volumen diario?', '10k al día',          // preguntas y respuestas
    'Medir el coste un mes'                        // próximos pasos
  ]) {
    assert.ok(md.includes(trozo), `falta en el informe: ${trozo}`);
  }
});

test('el acuerdo se entrega EXPLICADO y con lo que aportó cada lado, no como titular (R41)', () => {
  const md = renderInforme(state, meta);
  assert.match(md, /Qué se acordó/);
  assert.match(md, /Lo que aportó el lado 1/);
  assert.match(md, /Lo que aportó el lado 2/);
  assert.match(md, /Qué implica/);
});

test('el informe abre con la idea YA COCINADA: cómo queda después del debate (R44)', () => {
  const md = renderInforme(state, meta);

  assert.match(md, /Cómo queda la idea|How the idea stands/);
  assert.match(md, /publica el pedido en una cola y responde sin esperar/);
  // y va antes que el acta: es el entregable, no el apéndice
  assert.ok(md.indexOf('Qué es') < md.indexOf('Se debatió una cola de eventos'));
});

test('lo no cerrado viaja DENTRO de la propuesta, no en una sección de desacuerdos (R42)', () => {
  const md = renderInforme(state, meta);

  assert.match(md, /\[PENDIENTE: cuánto cuesta operar la cola/);
  assert.equal(/Puntos que quedaron sin cerrar|Points left unsettled/.test(md), false);
  assert.equal(/\*\*D2\*\*/.test(md), false);   // el registro numerado vive en debate.json (R43)
});

test('el registro crudo de desacuerdos sigue entero en el JSON, para poder auditar el informe (R43)', () => {
  const rec = buildRecord(state, meta);
  assert.equal(rec.desacuerdos.abiertos[0].n, 2);
  assert.equal(rec.desacuerdos.abiertos[0].by, 'b');
  assert.equal(rec.desacuerdos.resueltos[0].porque, 'el pico se absorbe en la cola');
});

test('si el debate se cortó y no hay propuesta, lo que estaba en disputa sí se enseña (R42, R30)', () => {
  // Sin propuesta, callar lo que quedaba abierto sería entregar un informe que parece completo.
  const md = renderInforme({ ...state, synthesis: '', closedBy: 'budget' }, meta);
  assert.match(md, /Puntos que quedaron sin cerrar|Points left unsettled/);
  assert.match(md, /el coste de operación no está medido/);
});

test('una pregunta sin responder aparece marcada como tal, no se esconde (R19, R24)', () => {
  const md = renderInforme(state, meta);
  const linea = md.split('\n').find((l) => l.includes('¿qué presupuesto?'));
  assert.ok(linea && !linea.includes('10k'), 'la pregunta sin responder debe seguir en el informe');
});

test('el informe dice cómo se cerró el debate: no es lo mismo acordar que agotar las rondas (R16)', () => {
  assert.match(renderInforme(state, meta), /2\s*\/\s*3/);   // rondas gastadas de las previstas
  assert.notEqual(renderInforme({ ...state, closedBy: 'agreement' }, meta), renderInforme(state, meta));
});

test('un debate roto a mitad produce informe PARCIAL con lo ya pagado y dice dónde falló (R30)', () => {
  const roto = { ...state, closedBy: 'error', synthesis: '', error: { round: 2, by: 'b', message: 'API 503: upstream unavailable' } };
  const md = renderInforme(roto, meta);

  assert.match(md, /503/);
  assert.ok(md.includes('ARGUMENTO DE A') || md.includes('una cola de eventos'));   // lo pagado no se tira
});

test('el archivo de evidencia lleva todos los turnos, por ronda y con quién los dijo (R25)', () => {
  const md = renderDebateLog(state, meta);
  for (const t of ['ARGUMENTO DE A', 'ARGUMENTO DE B', 'REPLICA DE B', 'REPLICA DE A']) assert.ok(md.includes(t));
  // el orden real de la ronda 2 (abrió B) se conserva: el transcript sirve para auditar
  assert.ok(md.indexOf('REPLICA DE B') < md.indexOf('REPLICA DE A'));
  assert.ok(md.includes('anthropic/claude-opus-4.8'));   // aquí SÍ se dice quién es quién: es para el usuario
});

test('el JSON es el debate entero y no pierde la trazabilidad de los desacuerdos', () => {
  const rec = buildRecord(state, meta);
  assert.equal(rec.idea, state.idea);
  assert.equal(rec.closedBy, 'limit');
  assert.equal(rec.participants.a.model, 'anthropic/claude-opus-4.8');
  assert.equal(rec.turns.length, 4);
  assert.equal(rec.desacuerdos.abiertos[0].n, 2);
  assert.equal(rec.desacuerdos.resueltos[0].porque, 'el pico se absorbe en la cola');
  assert.equal(rec.generatedAt, meta.generatedAt);
  JSON.parse(JSON.stringify(rec));   // serializable de verdad
});

test('con dictamen, el informe dice el veredicto y si hubo empate por sesgo de orden (R22)', () => {
  const conJuez = { ...state, judgment: { ganador: '', empate: true, porque: ['cambia según el orden'], pasadas: [{}, {}] }, judgeIsParticipant: true };
  const md = renderInforme(conJuez, meta);
  // Los tests corren en los dos idiomas: se compara contra la etiqueta de cualquiera de ellos.
  assert.match(md.toLowerCase(), /empate|tie/);
  assert.match(md.toLowerCase(), /juez|judge/);   // y que el juez era juez y parte
});

test('los avisos de configuración llegan al informe: el lector debe saber con qué se generó (R4, R5)', () => {
  const md = renderInforme({ ...state, warnings: ['same-model', 'stale:a'] }, meta);
  assert.match(md.toLowerCase(), /mismo modelo|same model/);
});

// ── coste acotado: lo que el informe tiene que confesar (R33, R35) ─────────────────────────────

test('si los turnos vieron un RESUMEN, el informe enseña la idea íntegra y lo dice (R35)', () => {
  const conResumen = { ...state, idea: 'resumen corto', ideaFull: 'EL DOCUMENTO ENTERO DEL AUTOR', briefed: true };
  const md = renderInforme(conResumen, meta);

  assert.ok(md.includes('EL DOCUMENTO ENTERO DEL AUTOR'));   // el lector ve lo que él escribió
  assert.match(md.toLowerCase(), /resumen|summary/);          // y que el debate trabajó sobre un resumen

  const rec = buildRecord(conResumen, meta);
  assert.equal(rec.idea, 'EL DOCUMENTO ENTERO DEL AUTOR');
  assert.equal(rec.ideaBrief, 'resumen corto');               // el resumen también queda, para auditarlo
});

test('cerrado por presupuesto: se dice, y el informe se arma sin acta (R33)', () => {
  const cortado = { ...state, closedBy: 'budget', synthesis: '' };
  const md = renderInforme(cortado, meta);

  assert.match(md.toLowerCase(), /presupuesto|budget/);
  assert.match(md, /el coste de operación no está medido/);   // los hechos siguen ahí: los puso el motor
});

test('un acta que se quedó sin tokens se declara incompleta, no se entrega como entera (R41)', () => {
  // Medido en la corrida real: la llamada del acta devolvió exactamente su tope de salida y la
  // sección de decisiones quedó cortada a mitad de frase.
  const cortada = { ...state, synthesis: '===RESUMEN===\nse debatió la cola\n===ACUERDOS===\n### Uno\nQué se acordó: a medio' };
  const md = renderInforme(cortada, meta);
  assert.match(md.toLowerCase(), /incompleta|incomplete/);

  // y un acta entera no lleva ese aviso
  assert.equal(/incompleta|incomplete/i.test(renderInforme(state, meta)), false);
});

// ── el archivo de evidencia (R25) ──────────────────────────────────────────────────────────────

test('debate.md es la evidencia completa: idea, preguntas, turnos, contabilidad y acta cruda (R25)', () => {
  const md = renderDebateLog(state, meta);

  assert.match(md, /una cola de eventos para el checkout/);        // la idea
  assert.match(md, /¿qué volumen diario\?/);                        // las preguntas, con su respuesta
  assert.match(md, /10k al día/);
  assert.match(md, /ARGUMENTO DE A/);                               // los turnos, íntegros
  assert.match(md, /REPLICA DE A/);
  assert.match(md, /===PROPUESTA===/);                              // el acta tal cual llegó
  assert.match(md, /\*\*D2\*\*/);                                   // y AQUÍ sí va la contabilidad numerada
  assert.match(md, /\*\*D1\*\*[\s\S]*el pico se absorbe en la cola/);
});

test('cada turno dice qué abrió y qué resolvió: así se rastrea el informe hasta su turno (R25)', () => {
  const md = renderDebateLog(state, meta);
  assert.match(md, /abrió D2|opened D2/);
  assert.match(md, /resolvió D1|settled D1/);
});

test('sin acta, la evidencia lo dice en vez de dejar el hueco (R25, R30)', () => {
  const md = renderDebateLog({ ...state, synthesis: '', closedBy: 'error' }, meta);
  assert.match(md, /No hubo acta|no minutes/i);
});

test('la ratificación es evidencia: va entera al JSON (R47)', () => {
  const firmado = { ...state, ratification: { by: 'b', veredicto: 'correcciones', conforme: false, correcciones: ['falta el cupo mínimo'], aplicadas: true, error: '' } };
  const rec = buildRecord(firmado, meta);

  assert.equal(rec.ratification.by, 'b');
  assert.equal(rec.ratification.aplicadas, true);
  assert.deepEqual(rec.ratification.correcciones, ['falta el cupo mínimo']);
});

test('el informe declara si los dos lo firman, y con qué correcciones (R47)', () => {
  const conforme = renderInforme({ ...state, ratification: { by: 'b', conforme: true, correcciones: [], aplicadas: false } }, meta);
  assert.match(conforme, /ratific|ratified/i);   // el test corre en los dos idiomas
  assert.equal(/NO está ratificado|NOT ratified/.test(conforme), false);

  const corregido = renderInforme({ ...state, ratification: { by: 'b', conforme: false, correcciones: ['x', 'y'], aplicadas: true } }, meta);
  assert.match(corregido, /2 correcci|2 correction/);

  const sinFirma = renderInforme(state, meta);
  assert.match(sinFirma, /NO está ratificado|NOT ratified/);
});
