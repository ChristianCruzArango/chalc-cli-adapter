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
const MIN_TURNOS_PARA_CERRAR = 3;

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
  const { idea, ideaFull, rounds, roundsRun, turns, questions, desacuerdosAbiertos, desacuerdosResueltos } = state;
  return JSON.parse(JSON.stringify({ idea, ideaFull, rounds, roundsRun, turns, questions, desacuerdosAbiertos, desacuerdosResueltos }));
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
  for (const ref of resolvedRefs(turn, state.desacuerdosAbiertos)) {
    const i = state.desacuerdosAbiertos.findIndex((d) => d.n === ref.n);
    if (i === -1) continue;
    const [resuelto] = state.desacuerdosAbiertos.splice(i, 1);
    state.desacuerdosResueltos.push({ ...resuelto, resueltoEn: turn.round, resueltoPor: turn.by, porque: ref.why });
  }

  // El PRIMER turno del debate no puede abrir desacuerdos: todavía no hay postura ajena a la que
  // oponerse, así que lo que enumere son sus propias tesis o los riesgos que él mismo ve — y eso es
  // parte de su postura, no una disputa (R38). Sigue viajando al otro lado dentro del turno.
  if (state.turns.length <= 1) return;

  for (const item of turn.desacuerdos) {
    const { ref, texto } = splitRef(item);
    if (!texto) continue;

    // Citar un desacuerdo abierto PROPIO es repetirse; citar el del rival es rebatirlo, y eso sí es
    // una objeción nueva. La misma referencia significa cosas opuestas según a quién apunte (R39).
    const citado = ref ? state.desacuerdosAbiertos.find((d) => d.n === ref) : null;
    if (citado && citado.by === turn.by) continue;

    // Y la misma objeción reescrita con otras palabras tampoco es una nueva (R40).
    const yaEsta = [...state.desacuerdosAbiertos, ...state.desacuerdosResueltos].some((d) => sameText(d.texto, texto));
    if (yaEsta) continue;

    state.desacuerdosAbiertos.push({ n: ++state.lastN, texto, by: turn.by, round: turn.round });
    state.raisedTotal += 1;
  }
}

// ¿Se puede cerrar por acuerdo? Los dos últimos turnos —uno de cada lado— con acuerdo justificado,
// tras la primera vuelta completa y habiendo existido disenso real en algún momento.
function canClose(state) {
  if (state.turns.length < MIN_TURNOS_PARA_CERRAR || state.raisedTotal === 0) return false;
  const ultimo = (id) => [...state.turns].reverse().find((t) => t.by === id);
  const a = ultimo('a');
  const b = ultimo('b');
  return !!a && !!b && a.acuerdoJustificado && b.acuerdoJustificado;
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

  const state = {
    idea,
    ideaFull: ideaFull || idea,   // el texto que el usuario dio; `idea` puede ser su resumen (R35)
    participants,
    rounds,
    roundsRun: 0,
    turns: [],
    questions: [],
    desacuerdosAbiertos: [],
    desacuerdosResueltos: [],
    raisedTotal: 0,
    lastN: 0,
    closedBy: '',
    error: null,
    synthesis: '',
    ratification: null,
    judgment: null
  };

  // Un fallo de proveedor no tira el debate: se marca dónde ocurrió y se devuelve lo ya pagado (R30).
  const fail = (round, by, err) => {
    state.closedBy = 'error';
    state.error = { round, by, message: err?.message ? String(err.message) : String(err) };
    return state;
  };

  // Las preguntas nuevas se le trasladan al usuario en cuanto aparecen; las respuestas quedan en el
  // estado, que es lo que viaja al prompt del SIGUIENTE turno — de los dos lados (R18).
  const collectQuestions = async (entries) => {
    const { questions, nuevas } = mergeQuestions(entries, state.questions);
    state.questions = questions;
    if (!nuevas.length || typeof askUser !== 'function') return;
    for (const { id, respuesta } of (await askUser(nuevas)) || []) {
      state.questions = answerQuestion(state.questions, id, respuesta);
    }
  };

  // El freno de presupuesto se consulta ENTRE llamadas, nunca a mitad de una: cortar una petición ya
  // enviada no ahorra un token, solo tira lo que se acaba de pagar (R33).
  const sinPresupuesto = () => (typeof shouldStop === 'function' ? shouldStop(state) : false);
  if (sinPresupuesto()) { state.closedBy = 'budget'; return state; }

  // ── Ronda de aclaración: los dos leen la idea y preguntan lo que falte, ANTES de discutir (R17) ──
  // Solo si hay quien conteste: pagar dos llamadas para producir preguntas que nadie leerá es tirar
  // el dinero por el mismo agujero que esta feature dice vigilar (R34).
  const aclaraciones = [];
  for (const id of (clarify ? ['a', 'b'] : [])) {
    try {
      const raw = await ask({ kind: 'clarify', participant: participants[id], round: 0, state: snapshot(state) });
      aclaraciones.push({ by: id, preguntas: parseTurn(raw, { round: 0, by: id }).preguntas });
    } catch (err) {
      return fail(0, id, err);
    }
  }
  await collectQuestions(aclaraciones);
  if (sinPresupuesto()) { state.closedBy = 'budget'; return state; }

  // ── Las rondas ────────────────────────────────────────────────────────────────────────────────
  for (let round = 1; round <= rounds && !state.closedBy; round++) {
    state.roundsRun = round;
    for (const id of orderFor(round)) {
      const participant = participants[id];
      let turn;
      try {
        const raw = await ask({ kind: 'turn', participant, round, state: snapshot(state) });
        turn = parseTurn(raw, { round, by: id, stance: participant.stance });
      } catch (err) {
        return fail(round, id, err);
      }
      // Se juzga contra los desacuerdos que estaban abiertos CUANDO se escribió el turno: es la lista
      // que el modelo tenía delante, y juzgarlo por otra sería cambiarle el examen después de hacerlo.
      turn.acuerdoJustificado = isJustifiedAgreement(turn, state.desacuerdosAbiertos);
      state.turns.push(turn);
      applyTurn(state, turn);
      await collectQuestions([{ by: id, preguntas: turn.preguntas }]);
      onTurn?.(turn, state);

      if (canClose(state)) { state.closedBy = 'agreement'; break; }
      if (sinPresupuesto()) { state.closedBy = 'budget'; break; }
    }
    onRound?.(round, state);
  }
  if (!state.closedBy) state.closedBy = 'limit';

  // ── El acta ───────────────────────────────────────────────────────────────────────────────────
  // Una sola llamada, con el debate entero delante. No elige ganador: eso lo decide el usuario (R21).
  // Con el presupuesto agotado NO se pide: es la llamada más cara del debate, y un freno que se salta
  // justo el gasto mayor no es un freno (R33). El informe se arma igual con lo que el motor extrajo.
  if (state.closedBy === 'budget') return state;
  try {
    state.synthesis = await ask({ kind: 'synthesis', round: state.roundsRun, state: snapshot(state) });
  } catch (err) {
    return fail(state.roundsRun, 'synthesis', err);
  }

  // ── La ratificación ───────────────────────────────────────────────────────────────────────────
  // Un informe que dice representar a dos partes y que solo ha visto una no es un acuerdo: es una
  // versión. Lo revisa el lado que NO lo escribió, y si señala correcciones se reescribe con ellas
  // dentro antes de entregarlo (R46).
  //
  // Si el presupuesto ya no da, se entrega SIN ratificar y así queda dicho: es peor firmar por el
  // otro que reconocer que no le dio tiempo a leerlo (R48).
  if (sinPresupuesto()) return state;

  const revisor = participants[rapporteur === 'a' ? 'b' : 'a'];
  try {
    const raw = await ask({ kind: 'ratify', participant: revisor, informe: state.synthesis, state: snapshot(state) });
    const s = parseSections(raw, RATIFY_SECTIONS);
    const veredicto = /conforme/i.test(s.VEREDICTO) ? 'conforme' : (/correc/i.test(s.VEREDICTO) ? 'correcciones' : '');
    const correcciones = s.CORRECCIONES.split('\n').map((l) => l.replace(/^\s*[-*•]\s*/, '').trim()).filter(Boolean);
    state.ratification = { by: revisor.id, veredicto, conforme: veredicto === 'conforme', correcciones, aplicadas: false, error: '' };

    // Un veredicto ilegible NO es un "conforme": ante la duda, el informe sale sin ratificar.
    if (veredicto === 'correcciones' && correcciones.length && !sinPresupuesto()) {
      state.synthesis = await ask({ kind: 'rewrite', informe: state.synthesis, correcciones, state: snapshot(state) });
      state.ratification.aplicadas = true;
    }
  } catch (err) {
    state.ratification = { by: revisor.id, veredicto: '', conforme: false, correcciones: [], aplicadas: false, message: '', error: err?.message ? String(err.message) : String(err) };
  }
  return state;
}
