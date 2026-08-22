// test/debate-questions.test.mjs — specs/014-debate R17 (fusión) y R19 (pregunta sin responder).
//
// Los dos participantes leen la misma idea, así que tropiezan con los mismos huecos: sin fusionar,
// el usuario contesta dos veces lo mismo y aprende a saltarse las preguntas — que es justo lo que
// esta feature necesita que no pase.

import test from 'node:test';
import assert from 'node:assert/strict';
import { answerQuestion, mergeQuestions, unanswered } from '../lib/debate/questions.mjs';

const entries = (a = [], b = []) => [{ by: 'a', preguntas: a }, { by: 'b', preguntas: b }];

test('dos preguntas idénticas de los dos lados se hacen UNA sola vez (R17)', () => {
  const { questions } = mergeQuestions(entries(['¿Qué volumen diario esperas?'], ['¿Qué volumen diario esperas?']));
  assert.equal(questions.length, 1);
  assert.deepEqual(questions[0].pedidaPor, ['a', 'b']);
});

test('la fusión ignora tildes, mayúsculas, signos y espacios de más (R17)', () => {
  const { questions } = mergeQuestions(entries(['¿Que VOLUMEN   diario esperas?'], ['que volumen diario esperas']));
  assert.equal(questions.length, 1);
});

test('una pregunta contenida en la otra se fusiona y se conserva la más informativa (R17)', () => {
  const { questions } = mergeQuestions(entries(['¿qué presupuesto hay?'], ['¿qué presupuesto hay? mensual o anual']));
  assert.equal(questions.length, 1);
  assert.match(questions[0].texto, /mensual o anual/);
  assert.deepEqual(questions[0].pedidaPor, ['a', 'b']);
});

test('preguntas distintas se conservan las dos, en el orden en que llegaron', () => {
  const { questions } = mergeQuestions(entries(['¿qué volumen?'], ['¿qué presupuesto?']));
  assert.deepEqual(questions.map((q) => q.texto), ['¿qué volumen?', '¿qué presupuesto?']);
});

test('cada pregunta nace sin responder y con id estable (R19)', () => {
  const { questions } = mergeQuestions(entries(['¿a?', '¿b?']));
  assert.deepEqual(questions.map((q) => q.id), ['q1', 'q2']);
  assert.equal(questions.every((q) => q.respondida === false && q.respuesta === ''), true);
});

test('preguntas de una ronda posterior no repiten las ya hechas y siguen la numeración (R18)', () => {
  const { questions } = mergeQuestions(entries(['¿qué volumen?']));
  const segunda = mergeQuestions(entries([], ['¿Qué volumen?', '¿y el presupuesto?']), questions);

  assert.deepEqual(segunda.questions.map((q) => q.id), ['q1', 'q2']);
  assert.deepEqual(segunda.nuevas.map((q) => q.texto), ['¿y el presupuesto?']);   // solo se pregunta lo nuevo
  assert.deepEqual(segunda.questions[0].pedidaPor, ['a', 'b']);                    // pero consta que b también la pedía
});

test('responder marca la pregunta y deja de estar pendiente', () => {
  const { questions } = mergeQuestions(entries(['¿qué volumen?', '¿qué presupuesto?']));
  const tras = answerQuestion(questions, 'q1', '  unos 10k al día  ');

  assert.equal(tras[0].respondida, true);
  assert.equal(tras[0].respuesta, 'unos 10k al día');
  assert.deepEqual(unanswered(tras).map((q) => q.id), ['q2']);
});

test('saltar una pregunta la deja sin responder pero NO la borra (R19)', () => {
  const { questions } = mergeQuestions(entries(['¿qué volumen?']));
  const tras = answerQuestion(questions, 'q1', '   ');

  assert.equal(tras[0].respondida, false);
  assert.equal(tras[0].texto, '¿qué volumen?');   // sigue ahí: acabará en el informe como duda abierta
});

test('listas vacías o ausentes no rompen ni inventan preguntas', () => {
  assert.deepEqual(mergeQuestions([]).questions, []);
  assert.deepEqual(mergeQuestions(entries()).questions, []);
  assert.deepEqual(mergeQuestions([{ by: 'a' }]).questions, []);
  assert.deepEqual(mergeQuestions(entries(['   ', ''])).questions, []);
});
