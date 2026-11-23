// specparse.mjs — lectura estructural de spec.md, plan.md y tasks.md (spec 024). Responsabilidad ÚNICA:
// localizar requisitos declarados, tareas y citas, con su línea. Razón de cambio: el formato de esos archivos.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.

const BULLET = /^\s*[-*]\s/;
const HEADING = /^\s*#/;
// Un requisito se DECLARA al inicio de un ítem: `- **R1** (HU-1) — WHEN …`. Un `**R1**` en mitad de una
// frase (el «_Ejemplo:_ **R1** — …» de la plantilla) es una mención, no una declaración.
const REQUIREMENT = /^\s*(?:[-*]\s+)?\*\*(R\d+)\*\*/;
const TASK = /^\s*[-*]\s+\[[ xX]\]\s/;

export const linesOf = (text) => String(text).split(/\r?\n/);

// Ítems que abre `opens` (línea → match o null), cada uno con su línea y su texto completo: la línea que lo
// abre más las de continuación, hasta una línea en blanco, otra viñeta o un encabezado.
function itemBlocks(text, opens) {
  const blocks = [];
  let current = null;
  linesOf(text).forEach((raw, index) => {
    const match = opens(raw);
    if (match) { current = { line: index + 1, text: raw, match }; blocks.push(current); return; }
    if (!raw.trim() || BULLET.test(raw) || HEADING.test(raw)) { current = null; return; }
    if (current) current.text += `\n${raw}`;
  });
  return blocks;
}

/** Requisitos declarados en la spec: [{ id, line, text }]. */
export const requirementsIn = (spec) => itemBlocks(spec, (raw) => REQUIREMENT.exec(raw))
  .map(({ line, text, match }) => ({ id: match[1], line, text }));

/** Tareas de tasks.md (casillas): [{ line, text }]. */
export const tasksIn = (tasks) => itemBlocks(tasks, (raw) => TASK.test(raw)).map(({ line, text }) => ({ line, text }));

/** Todas las citas que casan `pattern` (global) en `text`: [{ id, line }]. */
export function citationsIn(text, pattern) {
  return linesOf(text).flatMap((raw, index) => [...raw.matchAll(pattern)].map((m) => ({ id: m[0], line: index + 1 })));
}

/** `text` sin sus tramos de código en línea: lo citado entre comillas invertidas se nombra, no se afirma. */
export const withoutInlineCode = (text) => String(text).replace(/`[^`\n]*`/g, '');

/** La primera tarea sin marcar de tasks.md (la tarea EN CURSO): { text, line }; `text` es '' si no queda ninguna. */
export function firstOpenTaskAt(tasks) {
  const source = String(tasks ?? '');
  const match = /^\s*[-*]\s*\[ \]\s*(.+)$/m.exec(source);
  return match ? { text: match[1].trim(), line: source.slice(0, match.index).split('\n').length + (match[0].startsWith('\n') ? 1 : 0) } : { text: '', line: 0 };
}

/** Solo su texto. */
export const firstOpenTask = (tasks) => firstOpenTaskAt(tasks).text;
