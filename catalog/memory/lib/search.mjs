// search.mjs — la búsqueda a mano en la memoria (spec 015, R20). Responsabilidad ÚNICA: ordenar las
// entradas por cuánto responden a una consulta libre. Razón de cambio: cómo se puntúa una consulta.
//
// Este archivo lo emite chalc dentro de `.chalc/memory/lib/`. No edites aquí: se regenera al equipar.
//
// Es lo que usa un modelo fuera del ciclo, o una persona. Pesa más el CONCEPTO que la palabra: quien
// busca «tarifas» quiere las reglas de dinero aunque ninguna diga «tarifa». Puro y sin índices: unas
// miles de entradas se recorren en milisegundos, y un índice sería otro archivo que mantener al día.

import { conceptsIn, normalize } from './concepts.mjs';

export const SEARCH_LIMIT = 8;

const wordsOf = (text) => String(text ?? '').split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2).map(normalize);

// Cuánto responde una entrada: cada concepto compartido vale tres palabras.
function scoreOf(entry, words, concepts) {
  const text = new Set(wordsOf(`${entry.title} ${entry.detail ?? ''} ${(entry.files || []).join(' ')}`));
  const sharedConcepts = (entry.concepts || []).filter((c) => concepts.includes(c)).length;
  return sharedConcepts * 3 + words.filter((w) => text.has(w)).length;
}

// Las entradas que responden a `query`, de la que más a la que menos, y como mucho `limit`.
export function search(entries, query, conceptMap, { limit = SEARCH_LIMIT } = {}) {
  const words = wordsOf(query);
  const concepts = conceptsIn(query, conceptMap);
  return entries
    .map((entry) => ({ entry, score: scoreOf(entry, words, concepts) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || (b.entry.seen ?? 0) - (a.entry.seen ?? 0))
    .slice(0, limit)
    .map(({ entry }) => entry);
}
