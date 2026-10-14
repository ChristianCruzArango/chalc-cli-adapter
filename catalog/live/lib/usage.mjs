// usage.mjs — tokens y tiempo por tarea para el tablero (spec 020, R12). Responsabilidad ÚNICA: sumar el
// `usage` de las líneas nuevas de un transcript y cargarlo a la tarea en curso. Razón de cambio: cómo deja
// Claude Code el consumo en sus transcripts. Puro: quien lee los archivos y guarda el acumulado es `record.mjs`.
//
// Este archivo lo emite chalc dentro de `.chalc/live/lib/`. No edites aquí: se regenera al equipar.
//
// Un mismo mensaje del modelo aparece en VARIAS líneas del transcript —una por bloque de contenido— con el
// mismo `usage`: se cuenta una sola vez por `message.id`. Como un mensaje puede quedar partido entre dos
// eventos, se recuerdan los últimos ids vistos de cada transcript.

import { cleanTaskText, taskList } from '../../next/lib/tasks.mjs';

export const USAGE_REL = '.chalc/usage.json';
export const MAX_SEEN = 200;
export const ZERO = Object.freeze({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

const FIELDS = { input: 'input_tokens', output: 'output_tokens', cacheRead: 'cache_read_input_tokens', cacheWrite: 'cache_creation_input_tokens' };
const count = (value) => (Number.isFinite(value) ? value : 0);
const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

function parse(line) {
  try { return JSON.parse(line); } catch { return null; }
}

/** Suma el `usage` de los mensajes de `text` que no estén en `seen`. Devuelve `{ tokens, seen }` (ids recientes). */
export function usageOf(text, seen = []) {
  const known = new Set(seen);
  const tokens = { ...ZERO };
  for (const entry of String(text ?? '').split('\n').map(parse)) {
    const message = entry?.type === 'assistant' ? entry.message : null;
    if (!message?.id || !isObject(message.usage) || known.has(message.id)) continue;
    known.add(message.id);
    for (const [key, field] of Object.entries(FIELDS)) tokens[key] += count(message.usage[field]);
  }
  return { tokens, seen: [...known].slice(-MAX_SEEN) };
}

/** El nombre corto de una tarea: su id (`T3`) o, si no tiene, su texto. */
export function taskIdOf(text) {
  return String(text).match(/\bT\d+\b/)?.[0] || cleanTaskText(text);
}

/** La tarea en curso (la primera sin marcar), por su id; '' si no hay. */
export function currentTaskId(tasksText) {
  const pending = taskList(tasksText).find((t) => !t.done);
  return pending ? taskIdOf(pending.text) : '';
}

export const emptyStore = () => ({ cursors: {}, tasks: {} });

/** Un acumulado nuevo con `tokens` cargados a `task` y su tiempo extendido hasta `at`. No toca el que recibe. */
export function addUsage(store, { task, tokens, at }) {
  const base = isObject(store) ? store : emptyStore();
  const tasks = isObject(base.tasks) ? base.tasks : {};
  const before = tasks[task] || { ...ZERO, firstAt: at };
  const sum = Object.fromEntries(Object.keys(ZERO).map((key) => [key, count(before[key]) + count(tokens[key])]));
  return {
    cursors: isObject(base.cursors) ? base.cursors : {},
    tasks: { ...tasks, [task]: { ...sum, firstAt: before.firstAt, lastAt: at } }
  };
}
