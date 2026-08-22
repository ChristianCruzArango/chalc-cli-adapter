// lib/debate/questions.mjs — las preguntas que los participantes le hacen al usuario (spec 014, R17–R19).
// Responsabilidad ÚNICA: mantener la lista de preguntas sin duplicados y con su respuesta.
// Razón de cambio: cómo se decide que dos preguntas son la misma.
//
// Los dos leen la misma idea, así que encuentran los mismos huecos. Sin fusionar, el usuario contesta
// dos veces lo mismo y termina saltándose las preguntas — y una idea mal aclarada es un debate que
// discute sobre supuestos inventados.
//
// La equivalencia se decide por texto normalizado, no por semántica: es predecible, se explica en una
// frase y no cuesta una llamada. No entiende paráfrasis, y ese límite es aceptable — el peor caso es
// una pregunta parecida de más, no una respuesta perdida.

import { normalizeText, sameText } from './text.mjs';

/**
 * Fusiona las preguntas de esta tanda con las que ya existían.
 *
 * `entries`: `[{ by, preguntas: [...] }]` — sirve igual para la ronda de aclaración (los dos lados)
 * que para una pregunta suelta a mitad de debate (un lado).
 *
 * Devuelve la lista completa y, aparte, `nuevas`: las que todavía no se le han hecho al usuario.
 * Preguntar dos veces lo mismo cuesta la paciencia del usuario, que es más cara que un token.
 */
export function mergeQuestions(entries = [], existing = []) {
  const questions = existing.map((q) => ({ ...q, pedidaPor: [...q.pedidaPor] }));
  const nuevas = [];

  for (const { by, preguntas } of entries) {
    for (const texto of preguntas || []) {
      const limpio = String(texto).trim();
      if (!limpio) continue;
      const norm = normalizeText(limpio);
      if (!norm) continue;

      const previa = questions.find((q) => sameText(q.texto, norm));
      if (previa) {
        if (by && !previa.pedidaPor.includes(by)) previa.pedidaPor.push(by);
        // La versión más larga es la que más contexto le da al usuario para responder.
        if (limpio.length > previa.texto.length) previa.texto = limpio;
        continue;
      }

      const pregunta = { id: `q${questions.length + 1}`, texto: limpio, pedidaPor: by ? [by] : [], respuesta: '', respondida: false };
      questions.push(pregunta);
      nuevas.push(pregunta);
    }
  }
  return { questions, nuevas };
}

/**
 * Responde una pregunta. Una respuesta vacía —el usuario la saltó— NO la marca como respondida y
 * tampoco la borra: sigue en la lista y acaba en el informe como duda abierta (R19).
 */
export function answerQuestion(questions, id, respuesta) {
  const texto = String(respuesta ?? '').trim();
  return questions.map((q) => (q.id === id ? { ...q, respuesta: texto, respondida: !!texto } : q));
}

/** Las que siguen sin respuesta: lo que el debate tuvo que asumir a ciegas. */
export function unanswered(questions = []) {
  return questions.filter((q) => !q.respondida);
}
