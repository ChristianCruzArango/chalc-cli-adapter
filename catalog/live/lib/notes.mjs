// notes.mjs — las notas de cada rol, tal como las dejó (spec 020, R18). Responsabilidad ÚNICA: partir
// `.chalc/review.md` en entradas y conservar cada línea entera con su marca. Razón de cambio: cómo se
// presentan las notas. Puro: quien lee el archivo es el servidor.
//
// Este archivo lo emite chalc dentro de `.chalc/live/lib/`. No edites aquí: se regenera al equipar.
//
// El advisor lee la misma bitácora (`allReviews`) para DECIDIR, y se queda con estados y `archivo:línea`; la
// explicación que el rol escribe al lado se descarta. Aquí se conserva, porque es lo que una persona quiere
// leer. La cabecera se reconoce con la MISMA gramática del advisor: lo que él no lee como entrada, el tablero
// tampoco lo muestra como tal.

import { ENTRY } from '../../next/lib/review.mjs';

export const MAX_NOTES = 60;

// La marca de una línea por su estado, en es y en. El orden importa: «no cumple» antes que «cumple».
const MARKS = [
  ['violates', /^(no cumple|violates)\b/i],
  ['complies', /^(cumple|complies)\b/i],
  ['not-fixed', /^(no corregido|not fixed|not-fixed)\b/i],
  ['fixed', /^(corregido|fixed)\b/i],
  ['na', /^(no aplica|n\/a|not applicable)/i],
  ['reviewed', /^(revisado|reviewed)\b/i]
];

function markOf(text) {
  if (/^\d+\.\s/.test(text)) return 'finding';
  const status = text.match(/^[^:]+:\s*(.+)$/)?.[1] || '';
  return MARKS.find(([, pattern]) => pattern.test(status))?.[0] || 'note';
}

function entryOf(match) {
  const [, date, commit, role, verdict] = match;
  return { at: new Date(date).toISOString(), commit, role, ok: verdict === 'OK', findings: Number(verdict.split(':')[1] || 0), lines: [] };
}

/** Las entradas de la bitácora, la más reciente primero (las últimas `MAX_NOTES`), con sus líneas íntegras. */
export function reviewNotes(text) {
  const entries = [];
  let current = null;
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    const header = line.match(ENTRY);
    if (header) entries.push(current = entryOf(header));
    else if (line.startsWith('##')) current = null;
    else if (current && line) {
      const body = line.replace(/^[-*]\s+/, '');
      current.lines.push({ text: body, mark: markOf(body) });
    }
  }
  return entries.slice(-MAX_NOTES).reverse();
}

/** La tarea en curso en `iso` según la actividad (la más nueva primero): la de la última acción hasta ese momento. */
export function taskAt(iso, activity) {
  const at = Date.parse(iso);
  return activity.find((a) => Date.parse(a.at) <= at)?.task || '';
}
