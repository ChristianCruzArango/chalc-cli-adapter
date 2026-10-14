// T6 (spec 022, R18, F1 y F12) — los veredictos del debate se leen por su primera línea o una etiqueta
// explícita, nunca por la primera palabra que aparezca: "No conforme" no ratifica, y "la 1 y la 2
// están parejas" no da ganador.

import test from 'node:test';
import assert from 'node:assert/strict';
import { runDebate } from '../lib/debate/engine.mjs';
import { judge } from '../lib/debate/judge.mjs';

const participants = {
  a: { id: 'a', stance: 'proponent', model: 'modelo-a', provider: 'openrouter' },
  b: { id: 'b', stance: 'challenger', model: 'modelo-b', provider: 'openai' }
};
const turno = () => ['===POSTURA===', 'argumento', '===ESTADO===', 'acuerdo: no'].join('\n');
const minutes = '===PROPUESTA===\nel acta\n===PROXIMOS_PASOS===\n- empezar';
const ratifica = (verdict, corrections = []) =>
  ['===VEREDICTO===', verdict, '===CORRECCIONES===', ...corrections.map((c) => `- ${c}`)].join('\n');

async function ratifyWith(raw) {
  const responses = [turno(), turno(), minutes, raw, minutes];
  let i = 0;
  const ask = async () => responses[i++] ?? turno();
  const state = await runDebate({ idea: 'idea', participants, rounds: 1, clarify: false, ask, rapporteur: 'a' });
  return state.ratification;
}

// ── F1: ratificación ─────────────────────────────────────────────────────────────────────────────
test('F1: "No conforme" NO ratifica el informe', async () => {
  const r = await ratifyWith(ratifica('No conforme'));
  assert.equal(r.agreed, false);
  assert.notEqual(r.verdict, 'conforme');
});

test('F1: "no conforme" con correcciones se trata como correcciones', async () => {
  const r = await ratifyWith(ratifica('no conforme', ['falta el cupo mínimo']));
  assert.equal(r.verdict, 'correcciones');
  assert.equal(r.agreed, false);
});

test('F1: "conforme" solo en la primera línea ratifica (con comillas o punto también)', async () => {
  assert.equal((await ratifyWith(ratifica('conforme'))).agreed, true);
  assert.equal((await ratifyWith(ratifica('"Conforme."'))).agreed, true);
});

test('F1: "conforme" en mitad de una frase no ratifica', async () => {
  const r = await ratifyWith(ratifica('casi conforme, pero falta algo'));
  assert.equal(r.agreed, false);
});

// ── F12: dictamen del juez ───────────────────────────────────────────────────────────────────────
const state = {
  idea: 'cola',
  turns: [{ round: 1, by: 'a', position: 'pro' }, { round: 1, by: 'b', position: 'contra' }],
  openDisagreements: [{ n: 1, text: 'coste', by: 'b', round: 1 }]
};
const dictamen = (v) => `===VEREDICTO===\n${v}\n===PORQUE===\nporque sí`;

test('F12: "la 1 y la 2 están parejas" sin la palabra empate NO da ganador', async () => {
  const r = await judge({ state, ask: async () => dictamen('la 1 y la 2 están parejas'), lang: 'es' });
  assert.equal(r.tie, true);
  assert.deepEqual(r.past.map((p) => p.winner), ['', '']);
});

test('F12: la etiqueta explícita GANA: / WINNER: se respeta', async () => {
  let n = 0;
  const r = await judge({ state, ask: async () => dictamen(++n === 1 ? 'GANA: 1' : 'WINNER: 2'), lang: 'es' });
  assert.equal(r.winner, 'a');
  assert.equal(r.tie, false);
});

test('F12: el número en la primera línea sigue valiendo (formato que pide el prompt)', async () => {
  let n = 0;
  const r = await judge({ state, ask: async () => dictamen(++n === 1 ? '1\nla otra flojea' : '"2".'), lang: 'es' });
  assert.equal(r.winner, 'a');
});

test('F12: un número enterrado en la segunda línea no cuenta', async () => {
  const r = await judge({ state, ask: async () => dictamen('depende\nquizá la 1'), lang: 'es' });
  assert.deepEqual(r.past.map((p) => p.winner), ['', '']);
});
