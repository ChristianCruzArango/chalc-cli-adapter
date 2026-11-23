// lessons.mjs — de lo aprendido a lo que recibe el equipo (spec 036, R5–R7). Responsabilidad ÚNICA: decidir qué
// lecciones van en una orden, cuáles son candidatas y promoverlas o retirarlas. Razón de cambio: la política
// de qué aprende el equipo entero.
//
// Este archivo lo emite chalc dentro de `.chalc/memory/lib/`. No edites aquí: se regenera al equipar el repo.
//
// Una lección que se repite es una candidata; que pase a ser regla de TODO el equipo lo decide una persona. Y
// son pocas: una orden con veinte reglas enseña a no leer ninguna.

import { loadConcepts } from './concepts.mjs';
import { RECALL_LIMIT, recall, taskConcepts } from './recall.mjs';
import { mark, readMemory } from './store.mjs';

/** Cuántas lecciones pueden estar promovidas a la vez. */
export const MAX_PROMOTED = 20;
const REPEATED = 2;

const bySeen = (a, b) => (b.seen ?? 0) - (a.seen ?? 0) || String(b.date).localeCompare(String(a.date));

/** Lo que se repitió y nadie ha promovido todavía, lo más repetido primero. */
export const candidatesOf = (entries) => entries.filter((e) => (e.seen ?? 0) >= REPEATED && e.promoted !== true).sort(bySeen);

/** Las lecciones de una orden: primero las promovidas y después las que comparten concepto, `limit` como mucho. */
export function lessonsOf(entries, concepts, { limit = RECALL_LIMIT } = {}) {
  const promoted = entries.filter((e) => e.promoted === true).sort(bySeen);
  const related = recall(entries.filter((e) => e.promoted !== true), concepts, { limit });
  return [...promoted, ...related].slice(0, limit);
}

/** Las lecciones vigentes para una spec, leídas de la memoria del proyecto: [{ id, title, promoted }]. */
export async function lessonsFor(root, specText) {
  const { entries } = await readMemory(root);
  if (!entries.length) return [];
  const concepts = taskConcepts({ task: '', spec: specText || '', concepts: await loadConcepts(root) });
  return lessonsOf(entries, concepts).map((e) => ({ id: e.id, title: e.title, promoted: e.promoted === true }));
}

/** Promueve (o retira) la entrada `id`. Devuelve '' si lo hizo, o por qué no: `no-entry`, `full`. */
export async function setPromoted(root, id, value) {
  const { entries } = await readMemory(root);
  const entry = entries.find((e) => e.id === id);
  if (!entry) return 'no-entry';
  if (value && entry.promoted !== true && entries.filter((e) => e.promoted === true).length >= MAX_PROMOTED) return 'full';
  await mark(root, entry.key, { promoted: value });
  return '';
}
