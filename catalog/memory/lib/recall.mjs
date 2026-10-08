// recall.mjs — qué le toca a cada tarea (spec 015, R10, R15, R18). Responsabilidad ÚNICA: elegir
// las pocas entradas de memoria que aplican a una tarea. Razón de cambio: cómo se decide qué aplica.
//
// Este archivo lo emite chalc dentro de `.chalc/memory/lib/`. No edites aquí: se regenera al equipar.
//
// Carga perezosa: la memoria entera nunca se entrega. Primero se decide de qué conceptos habla la
// TAREA, y solo si no dice nada se mira la spec. Después se entregan como mucho unas pocas entradas,
// las que más pesan. Puro: recibe textos y entradas, devuelve entradas. Quien lee el disco es el
// advisor.

import { conceptsIn } from './concepts.mjs';

export const RECALL_LIMIT = 5;

// Primero lo que más cuesta repetir: un bug ya ocurrió; una regla, se aprendió; una decisión, se
// aceptó y basta con no reportarla otra vez.
const WEIGHT = { bug: 0, rule: 1, decision: 2 };

const CONCEPTS_LINE = /^\s*(?:conceptos|concepts)\s*:\s*(.+)$/im;

// El texto de los requisitos que cita la tarea, tal como los escribe la spec (`**R2**`).
function citedRequirements(task, spec) {
  const ids = String(task).match(/\bR\d+\b/g) || [];
  return String(spec).split('\n').filter((line) => ids.some((id) => line.includes(`**${id}**`))).join('\n');
}

// Los conceptos de la línea `Conceptos:` de la spec. Acepta sinónimos e inglés: «Money» es dinero.
function declaredConcepts(spec, concepts) {
  const line = CONCEPTS_LINE.exec(String(spec));
  if (!line) return [];
  const items = line[1].split(',').map((item) => item.trim()).filter(Boolean);
  return [...new Set(items.flatMap((item) => (concepts[item] ? [item] : conceptsIn(item, concepts))))].sort();
}

// Los conceptos de una tarea: los de su texto y los requisitos que cita; si no hay, los que declara
// la spec; y si tampoco, los de la spec entera, como último recurso.
export function taskConcepts({ task, spec, concepts }) {
  const own = conceptsIn(`${task}\n${citedRequirements(task, spec)}`, concepts);
  if (own.length) return own;
  const declared = declaredConcepts(spec, concepts);
  return declared.length ? declared : conceptsIn(spec, concepts);
}

const byWeight = (a, b) => (WEIGHT[a.kind] ?? 3) - (WEIGHT[b.kind] ?? 3)
  || (b.seen ?? 0) - (a.seen ?? 0)
  || String(b.date).localeCompare(String(a.date));

// Las entradas de esos conceptos, de la que más pesa a la que menos, y como mucho `limit`.
export function recall(entries, concepts, { limit = RECALL_LIMIT } = {}) {
  return entries.filter((e) => (e.concepts || []).some((c) => concepts.includes(c))).sort(byWeight).slice(0, limit);
}
