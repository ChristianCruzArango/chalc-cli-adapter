// lib/debate/engine.mjs — el bucle del debate (spec 014, R8, R11, R13–R16, R18, R28, R30).
// Responsabilidad ÚNICA: las reglas del debate. Razón de cambio: cómo se debate.
//
// No sabe que existe una IA ni una terminal: recibe `ask` (pedir un texto a un participante) y
// `askUser` (trasladarle preguntas al humano). Por eso el flujo completo —incluidos los cierres y el
// fallo de un proveedor a mitad— se prueba con turnos guionizados, sin red y sin gastar un token.
//
// Las dos reglas que justifican que esto sea un motor y no un bucle suelto:
//   · un acuerdo declarado no cierra nada si no está justificado (R12, lo decide `turn.mjs`);
//   · un debate donde NADIE objetó jamás tampoco cierra por acuerdo. Es el colapso por conformidad
//     que documenta la literatura: dos modelos dándose la razón desde el primer turno no son un
//     consenso, son un monólogo a dos voces. Que gaste sus rondas y se cierre por límite.

import { mergeQuestions, answerQuestion } from './questions.mjs';
import { isJustifiedAgreement, parseTurn, resolvedRefs, splitRef } from './turn.mjs';
import { parseSections } from '../promptkit.mjs';
import { RATIFY_SECTIONS } from './sections.mjs';
import { sameText } from './text.mjs';

// Turnos mínimos antes de poder cerrar por acuerdo: propuesta → rebate → respuesta (R11). El colapso
// por complacencia ocurre justo ahí, en la primera cesión; obligar a que la propuesta vuelva a pasar
// por su autor es lo que separa "me convenciste" de "no me apetece discutir".
const MIN_TURNS_TO_CLOSE = 3;

/**
 * Llamadas que costará el debate (R28, R37): la aclaración (dos, si hay quien responda), dos por
 * ronda, el acta, y las condicionales — comprimir una idea larga (una) y el juez (dos, porque evalúa
 * en los dos órdenes posibles, R22).
 *
 * El número que se anuncia tiene que ser el que se va a gastar: anunciar de más asusta y anunciar de
 * menos engaña.
 */
export function plannedCalls({ rounds, judge = false, clarify = true, brief = false } = {}) {
  // +2 fijas al final: la ratificación del informe por el lado que no lo escribió y la reescritura si
  // señala correcciones (R46). Se anuncia el caso peor: prometer menos de lo que puede costar es
  // exactamente lo que R28 existe para impedir.
  return (clarify ? 2 : 0) + (brief ? 1 : 0) + 2 * rounds + 1 + 2 + (judge ? 2 : 0);
}

// Lo que ve un participante de su prompt: el estado sin `participants` (nadie debe saber con qué
// modelo debate el otro — R9) y como copia, para que un turno no pueda modificar el debate.
function snapshot(state) {
  const { idea, ideaFull, rounds, roundsRun, turns, questions, openDisagreements, settledDisagreements } = state;
  return JSON.parse(JSON.stringify({ idea, ideaFull, rounds, roundsRun, turns, questions, openDisagreements, settledDisagreements }));
}

// El orden de la ronda: impar abre A, par abre B (R14). Quien habla último ancla la ronda siguiente;
// si siempre fuera el mismo, el debate tendría un ganador estructural antes de empezar.
function orderFor(round) {
  return round % 2 === 1 ? ['a', 'b'] : ['b', 'a'];
}

// Aplica el turno al estado: primero resuelve lo que cita (contra la lista que ese turno vio) y
// luego abre lo que objeta. Al revés, un desacuerdo nuevo podría llevar el número de uno recién
// cerrado y la cita apuntaría a otra cosa.
function applyTurn(state, turn) {
  for (const ref of resolvedRefs(turn, state.openDisagreements)) {
    const i = state.openDisagreements.findIndex((d) => d.n === ref.n);
    if (i === -1) continue;
    const [settledOne] = state.openDisagreements.splice(i, 1);
    state.settledDisagreements.push({ ...settledOne, settledIn: turn.round, settledBy: turn.by, why: ref.why });
  }

  // El PRIMER turno del debate no puede abrir desacuerdos: todavía no hay postura ajena a la que
  // oponerse, así que lo que enumere son sus propias tesis o los riesgos que él mismo ve — y eso es
  // parte de su postura, no una disputa (R38). Sigue viajando al otro lado dentro del turno.
  if (state.turns.length <= 1) return;

  for (const item of turn.disagreements) {
    const { ref, text } = splitRef(item);
    if (!text) continue;

    // Citar un desacuerdo abierto PROPIO es repetirse; citar el del rival es rebatirlo, y eso sí es
    // una objeción nueva. La misma referencia significa cosas opuestas según a quién apunte (R39).
    const cited = ref ? state.openDisagreements.find((d) => d.n === ref) : null;
    if (cited && cited.by === turn.by) continue;

    // Y la misma objeción reescrita con otras palabras tampoco es una nueva (R40).
    const alreadyThere = [...state.openDisagreements, ...state.settledDisagreements].some((d) => sameText(d.text, text));
    if (alreadyThere) continue;

    state.openDisagreements.push({ n: ++state.lastN, text, by: turn.by, round: turn.round });
    state.raisedTotal += 1;
  }
}

// ¿Se puede cerrar por acuerdo? Los dos últimos turnos —uno de cada lado— con acuerdo justificado,
// tras la primera vuelta completa y habiendo existido disenso real en algún momento.
function canClose(state) {
  if (state.turns.length < MIN_TURNS_TO_CLOSE || state.raisedTotal === 0) return false;
  const last = (id) => [...state.turns].reverse().find((t) => t.by === id);
  const a = last('a');
  const b = last('b');
  return !!a && !!b && a.justifiedAgreement && b.justifiedAgreement;
}

function initialState({ idea, ideaFull, participants, rounds }) {
  return {
    idea,
    ideaFull: ideaFull || idea,   // el texto que el usuario dio; `idea` puede ser su resumen (R35)
    participants,
    rounds,
    roundsRun: 0,
    turns: [],
    questions: [],
    openDisagreements: [],
    settledDisagreements: [],
    raisedTotal: 0,
    lastN: 0,
    closedBy: '',
    error: null,
    synthesis: '',
    ratification: null,
    judgment: null
  };
}

// Un fallo de proveedor no tira el debate: se marca dónde ocurrió y se devuelve lo ya pagado (R30).
function fail(state, round, by, err) {
  state.closedBy = 'error';
  state.error = { round, by, message: err?.message ? String(err.message) : String(err) };
  return state;
}

// Las preguntas nuevas se le trasladan al usuario en cuanto aparecen; las respuestas quedan en el
// estado, que es lo que viaja al prompt del SIGUIENTE turno — de los dos lados (R18).
async function collectQuestions(ctx, entries) {
  const { state, askUser } = ctx;
  const { questions, added } = mergeQuestions(entries, state.questions);
  state.questions = questions;
  if (!added.length || typeof askUser !== 'function') return;
  for (const { id, answer } of (await askUser(added)) || []) {
    state.questions = answerQuestion(state.questions, id, answer);
  }
}

// Ronda de aclaración: los dos leen la idea y preguntan lo que falte, ANTES de discutir (R17).
// Devuelve el error del proveedor, si lo hubo.
async function clarifyRound(ctx) {
  const clarifications = [];
  for (const id of ['a', 'b']) {
    try {
      const raw = await ctx.ask({ kind: 'clarify', participant: ctx.participants[id], round: 0, state: snapshot(ctx.state) });
      clarifications.push({ by: id, raisedQuestions: parseTurn(raw, { round: 0, by: id }).raisedQuestions });
    } catch (err) {
      return { round: 0, by: id, err };
    }
  }
  await collectQuestions(ctx, clarifications);
  return null;
}

// Un turno de una ronda. Devuelve el error del proveedor, si lo hubo.
async function playTurn(ctx, round, id) {
  const { state, participants } = ctx;
  const participant = participants[id];
  let turn;
  try {
    const raw = await ctx.ask({ kind: 'turn', participant, round, state: snapshot(state) });
    turn = parseTurn(raw, { round, by: id, stance: participant.stance });
  } catch (err) {
    return { round, by: id, err };
  }
  // Se juzga contra los desacuerdos que estaban abiertos CUANDO se escribió el turno: es la lista
  // que el modelo tenía delante, y juzgarlo por otra sería cambiarle el examen después de hacerlo.
  turn.justifiedAgreement = isJustifiedAgreement(turn, state.openDisagreements);
  state.turns.push(turn);
  applyTurn(state, turn);
  await collectQuestions(ctx, [{ by: id, raisedQuestions: turn.raisedQuestions }]);
  ctx.onTurn?.(turn, state);
  return null;
}

// Las rondas, hasta el acuerdo, el presupuesto o el límite. Devuelve el error del proveedor, si lo hubo.
async function playRounds(ctx, rounds) {
  const { state } = ctx;
  for (let round = 1; round <= rounds && !state.closedBy; round++) {
    state.roundsRun = round;
    for (const id of orderFor(round)) {
      const failure = await playTurn(ctx, round, id);
      if (failure) return failure;
      if (canClose(state)) { state.closedBy = 'agreement'; break; }
      if (ctx.outOfBudget()) { state.closedBy = 'budget'; break; }
    }
    ctx.onRound?.(round, state);
  }
  if (!state.closedBy) state.closedBy = 'limit';
  return null;
}

// La ratificación: un informe que dice representar a dos partes y que solo ha visto una no es un
// acuerdo: es una versión. Lo revisa el lado que NO lo escribió, y si señala correcciones se reescribe
// con ellas dentro antes de entregarlo (R46).
async function ratify(ctx, rapporteur) {
  const { state, participants } = ctx;
  const reviewer = participants[rapporteur === 'a' ? 'b' : 'a'];
  try {
    const raw = await ctx.ask({ kind: 'ratify', participant: reviewer, report: state.synthesis, state: snapshot(state) });
    const s = parseSections(raw, RATIFY_SECTIONS);
    const verdict = /conforme/i.test(s.VEREDICTO) ? 'conforme' : (/correc/i.test(s.VEREDICTO) ? 'correcciones' : '');
    const corrections = s.CORRECCIONES.split('\n').map((l) => l.replace(/^\s*[-*•]\s*/, '').trim()).filter(Boolean);
    state.ratification = { by: reviewer.id, verdict, agreed: verdict === 'conforme', corrections, applied: false, error: '' };

    // Un veredicto ilegible NO es un "conforme": ante la duda, el informe sale sin ratificar.
    if (verdict === 'correcciones' && corrections.length && !ctx.outOfBudget()) {
      state.synthesis = await ctx.ask({ kind: 'rewrite', report: state.synthesis, corrections, state: snapshot(state) });
      state.ratification.applied = true;
    }
  } catch (err) {
    state.ratification = { by: reviewer.id, verdict: '', agreed: false, corrections: [], applied: false, message: '', error: err?.message ? String(err.message) : String(err) };
  }
}

/**
 * Corre el debate entero y devuelve su estado final.
 *
 * `ask({ kind, participant, round, state })` → texto del modelo. `kind`: 'clarify' | 'turn' | 'synthesis'.
 * `askUser(preguntas)` → `[{ id, respuesta }]`. Ausente (no interactivo) = nadie responde, y el
 * debate sigue igual: bloquearse esperando a un humano que no está es peor que asumir a ciegas y
 * dejarlo escrito (R20).
 */
export async function runDebate({ idea, ideaFull = '', participants, rounds = 3, ask, askUser, onTurn, onRound, clarify = true, shouldStop, rapporteur = 'a' } = {}) {
  if (!Number.isInteger(rounds) || rounds < 1) throw new Error(`rounds must be an integer >= 1 (got ${rounds})`);
  const state = initialState({ idea, ideaFull, participants, rounds });
  // El freno de presupuesto se consulta ENTRE llamadas, nunca a mitad de una: cortar una petición ya
  // enviada no ahorra un token, solo tira lo que se acaba de pagar (R33).
  const outOfBudget = () => (typeof shouldStop === 'function' ? shouldStop(state) : false);
  const ctx = { state, participants, ask, askUser, onTurn, onRound, outOfBudget };
  const failed = (f) => fail(state, f.round, f.by, f.err);
  if (outOfBudget()) { state.closedBy = 'budget'; return state; }

  // Solo se aclara si hay quien conteste: pagar dos llamadas para producir preguntas que nadie leerá
  // es tirar el dinero por el mismo agujero que esta feature dice vigilar (R34).
  const unclear = clarify ? await clarifyRound(ctx) : null;
  if (unclear) return failed(unclear);
  if (outOfBudget()) { state.closedBy = 'budget'; return state; }

  const broken = await playRounds(ctx, rounds);
  if (broken) return failed(broken);

  // El acta: una sola llamada, con el debate entero delante. No elige ganador: eso lo decide el
  // usuario (R21). Con el presupuesto agotado NO se pide: es la llamada más cara del debate, y un
  // freno que se salta justo el gasto mayor no es un freno (R33).
  if (state.closedBy === 'budget') return state;
  try {
    state.synthesis = await ask({ kind: 'synthesis', round: state.roundsRun, state: snapshot(state) });
  } catch (err) {
    return fail(state, state.roundsRun, 'synthesis', err);
  }
  // Si el presupuesto ya no da, se entrega SIN ratificar y así queda dicho: es peor firmar por el
  // otro que reconocer que no le dio tiempo a leerlo (R48).
  if (!outOfBudget()) await ratify(ctx, rapporteur);
  return state;
}
