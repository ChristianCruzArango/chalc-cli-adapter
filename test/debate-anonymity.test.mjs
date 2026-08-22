// test/debate-anonymity.test.mjs — specs/014-debate R9 (anonimato y turno íntegro) y R31 (condensación).
//
// Anonimizar la fuente de cada turno es, según la literatura de multi-agent debate, la mitigación más
// efectiva contra la sycophancy por identidad: un modelo que sabe que le está respondiendo un modelo
// "más grande" cede sin argumento, y si reconoce su propia firma se da la razón a sí mismo. Aquí se
// comprueba que ni el nombre del modelo ni el del proveedor llegan al otro lado.

import test from 'node:test';
import assert from 'node:assert/strict';
import { BRIEF_THRESHOLD, buildBriefPrompt, buildClarifyPrompt, buildSynthesisPrompt, buildTurnPrompt, needsBrief } from '../lib/debate/prompts.mjs';

const participants = {
  a: { id: 'a', stance: 'proponent', model: 'anthropic/claude-opus-4.8', provider: 'openrouter' },
  b: { id: 'b', stance: 'challenger', model: 'gpt-oss:20b', provider: 'ollama' }
};

const turn = (round, by, texto) => ({
  round, by, stance: by === 'a' ? 'proponent' : 'challenger',
  postura: texto, acuerdos: [`acuerdo de ${by} en la ronda ${round}`], desacuerdos: [`objeción de ${by} en la ronda ${round}`],
  resueltos: [], preguntas: [], declaraAcuerdo: false,
  raw: `===POSTURA===\n${texto}`
});

const state = {
  idea: 'una cola de eventos para el checkout',
  rounds: 3,
  roundsRun: 2,
  turns: [
    turn(1, 'a', 'ARGUMENTO VIEJO DE A'),
    turn(1, 'b', 'ARGUMENTO VIEJO DE B'),
    turn(2, 'a', 'ARGUMENTO NUEVO DE A'),
    turn(2, 'b', 'ARGUMENTO NUEVO DE B')
  ],
  questions: [
    { id: 'q1', texto: '¿qué volumen diario?', pedidaPor: ['a'], respuesta: '10k al día', respondida: true },
    { id: 'q2', texto: '¿qué presupuesto?', pedidaPor: ['b'], respuesta: '', respondida: false }
  ],
  desacuerdosAbiertos: [{ n: 3, texto: 'el coste de operación no está medido', by: 'b', round: 2 }],
  desacuerdosResueltos: []
};

const todo = ({ system, user }) => `${system}\n${user}`;

test('el prompt de un participante no revela el modelo ni el proveedor del otro (R9)', async () => {
  const paraA = todo(await buildTurnPrompt({ participant: participants.a, state, lang: 'es' }));
  const paraB = todo(await buildTurnPrompt({ participant: participants.b, state, lang: 'es' }));

  for (const texto of [paraA, paraB]) {
    for (const filtrado of ['claude', 'opus', 'gpt-oss', 'openrouter', 'ollama', 'anthropic']) {
      assert.equal(texto.toLowerCase().includes(filtrado), false, `se filtró "${filtrado}" al prompt`);
    }
  }
});

test('el turno del otro llega ÍNTEGRO, no resumido (R9)', async () => {
  const { user } = await buildTurnPrompt({ participant: participants.a, state, lang: 'es' });
  assert.ok(user.includes('ARGUMENTO NUEVO DE B'), 'falta el último turno del otro lado');
});

test('las rondas viejas van condensadas: no se re-paga el contexto entero cada ronda (R31)', async () => {
  const { user } = await buildTurnPrompt({ participant: participants.a, state, lang: 'es' });

  assert.equal(user.includes('ARGUMENTO VIEJO DE B'), false);      // la ronda 1 ya no viaja íntegra
  assert.ok(user.includes('objeción de b en la ronda 1'));          // pero su sustancia sí
});

test('el participante recibe su propio turno anterior, separado del ajeno (R9)', async () => {
  const { user } = await buildTurnPrompt({ participant: participants.a, state, lang: 'es' });
  assert.ok(user.includes('ARGUMENTO NUEVO DE A'));
  assert.match(user, /<your_previous_turn>[\s\S]*ARGUMENTO NUEVO DE A[\s\S]*<\/your_previous_turn>/);
  assert.match(user, /<the_other_side>[\s\S]*ARGUMENTO NUEVO DE B[\s\S]*<\/the_other_side>/);
});

test('los desacuerdos abiertos viajan con SU número, que es el que se cita al resolverlos (R12)', async () => {
  const { user } = await buildTurnPrompt({ participant: participants.a, state, lang: 'es' });
  assert.match(user, /D3:\s*el coste de operación no está medido/);
});

test('las respuestas del autor viajan a los dos lados, y lo que no contestó consta como tal (R18, R19)', async () => {
  for (const p of [participants.a, participants.b]) {
    const { user } = await buildTurnPrompt({ participant: p, state, lang: 'es' });
    assert.match(user, /¿qué volumen diario\?[^\n]*10k al día/);
    assert.match(user, /¿qué presupuesto\?/);
  }
});

test('cada postura recibe SU plantilla: el proponente propone y el retador rebate (R8)', async () => {
  const a = (await buildTurnPrompt({ participant: participants.a, state, lang: 'es' })).system.toLowerCase();
  const b = (await buildTurnPrompt({ participant: participants.b, state, lang: 'es' })).system.toLowerCase();

  assert.ok(a.includes('proponent'));
  assert.ok(b.includes('challenger'));
  assert.notEqual(a, b);
});

test('el prompt de aclaración pide preguntas y todavía no una propuesta (R17)', async () => {
  const { system, user } = await buildClarifyPrompt({ participant: participants.b, state: { ...state, turns: [] }, lang: 'es' });
  assert.match(system, /===PREGUNTAS_USUARIO===/);
  assert.ok(user.includes('una cola de eventos para el checkout'));
});

test('el acta recibe el debate entero y tiene prohibido elegir ganador (R21)', async () => {
  const { system, user } = await buildSynthesisPrompt({ state, lang: 'es' });
  assert.match(system, /===PROPUESTA===/);   // el acta entrega la idea ya cocinada (R44)
  assert.match(system.toLowerCase(), /(never|not) (pick|choose)/);
  assert.ok(user.includes('ARGUMENTO NUEVO DE A') && user.includes('ARGUMENTO NUEVO DE B'));
});

test('todas las plantillas resuelven sus variables: ninguna ${VAR} llega al modelo', async () => {
  const prompts = [
    await buildTurnPrompt({ participant: participants.a, state, lang: 'es' }),
    await buildTurnPrompt({ participant: participants.b, state, lang: 'en' }),
    await buildClarifyPrompt({ participant: participants.a, state, lang: 'es' }),
    await buildSynthesisPrompt({ state, lang: 'en' })
  ];
  for (const p of prompts) assert.equal(/\$\{[A-Z_]+\}/.test(todo(p)), false);
});

// ── T26 · comprimir la idea UNA vez (R35) ──────────────────────────────────────────────────────
// Medido: con una idea pegada de un documento, el 57 % de toda la entrada del debate es esa misma
// idea repetida en cada llamada. Es el espíritu del CCR —comprimir una vez, reutilizar muchas—
// adaptado a que aquí los modelos no tienen herramientas y no podrían expandir una referencia.

test('una idea corta no se comprime: la referencia costaría más que el texto (R35)', () => {
  assert.equal(needsBrief('una cola de eventos para el checkout'), false);
  assert.equal(needsBrief(''), false);
  assert.equal(needsBrief(null), false);
});

test('una idea larga sí se comprime (R35)', () => {
  assert.equal(needsBrief('x'.repeat(BRIEF_THRESHOLD + 1)), true);
  assert.equal(needsBrief('x'.repeat(BRIEF_THRESHOLD - 1)), false);
});

test('el prompt de compresión lleva el texto íntegro y prohíbe inventar (R35)', async () => {
  const documento = 'HISTORIA DE USUARIO. '.repeat(200);
  const { system, user } = await buildBriefPrompt({ idea: documento, lang: 'es' });

  assert.ok(user.includes('HISTORIA DE USUARIO'));
  assert.match(system.toLowerCase(), /never invent|do not invent/);
  assert.equal(/\$\{[A-Z_]+\}/.test(system + user), false);
});

test('la ronda de aclaración ve el texto ÍNTEGRO, no el resumen (R35)', async () => {
  const conResumen = { ...state, idea: 'resumen corto', ideaFull: 'EL DOCUMENTO ENTERO' };
  const { user } = await buildClarifyPrompt({ participant: participants.a, state: conResumen, lang: 'es' });

  assert.ok(user.includes('EL DOCUMENTO ENTERO'));   // las preguntas salen del original, no del resumen
});

test('los turnos ven el resumen, no el documento entero (R35, R31)', async () => {
  const conResumen = { ...state, idea: 'resumen corto', ideaFull: 'EL DOCUMENTO ENTERO' };
  const { user } = await buildTurnPrompt({ participant: participants.a, state: conResumen, lang: 'es' });

  assert.ok(user.includes('resumen corto'));
  assert.equal(user.includes('EL DOCUMENTO ENTERO'), false);
});

// ── T27 · turnos acotados (R36) ────────────────────────────────────────────────────────────────
test('las dos plantillas de postura piden concisión: la salida cuesta cinco veces la entrada (R36)', async () => {
  for (const p of [participants.a, participants.b]) {
    const { system } = await buildTurnPrompt({ participant: p, state, lang: 'es' });
    assert.match(system.toLowerCase(), /\b(words|concise)\b/);
  }
});
