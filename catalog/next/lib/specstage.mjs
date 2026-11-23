// specstage.mjs — la etapa de spec del advisor (spec 024, R10, R11). Responsabilidad ÚNICA: decir si la spec
// de la carpeta activa ya la validó el rol de cadencia `spec` y la aprobó el usuario. Razón de cambio: qué se
// exige antes de dejar pasar a tests y código.
//
// Este archivo lo emite chalc dentro de `.chalc/next/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// PURO. Todo va atado a la HUELLA de HU+spec+plan+tareas, no a un commit: esta etapa ocurre antes de que
// exista código que medir. Editar cualquiera de los cuatro textos cambia la huella y lo invalida todo.

import { priorFindings } from './prior.mjs';

const sameSecond = (ms) => Math.floor(ms / 1000);

// Los que REVISAN la spec. Un rol `author` (el especificador) la escribe: su evidencia es que la carpeta
// quede sin problemas mecánicos, no una entrada en la bitácora.
const reviewers = (s) => (s.flow.roles || [])
  .filter((role) => role.required !== false && role.cadence === 'spec' && role.kind !== 'author')
  .sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity));

const entryOf = (s, role) => (s.review.entries || [])
  .filter((entry) => entry.role === role.id && entry.fingerprint === s.specs.fingerprint)
  .at(-1);

/** El rol de cadencia `spec` que firma como autor (a quien se le encarga corregir), o ''. */
export const specAuthor = (s) => (s.flow.roles || []).find((role) => role.cadence === 'spec' && role.kind === 'author')?.id || '';

/** El primer revisor de la spec que falta por pasar para la huella actual, o el primero con hallazgos. */
export function pendingSpecRole(s) {
  for (const role of reviewers(s)) {
    const entry = entryOf(s, role);
    if (!entry || !entry.ok) return { role, entry: entry || null };
  }
  return null;
}

/** ¿El usuario aprobó ESTA huella, y después de que la validaran? Aprueba lo validado, no lo anterior. */
export function specApproved(s) {
  if (!s.specs.approved) return false;
  const validated = reviewers(s).map((role) => entryOf(s, role)).filter(Boolean);
  return validated.every((entry) => sameSecond(s.specs.sealDate) >= sameSecond(entry.date));
}

/**
 * El snapshot sin la evidencia de una corrida que SOLO se quedó en la etapa `coherence`. Esa corrida no midió
 * código: una vez aprobada la spec no hay nada que «arreglar en el portón», y tratarla como evidencia dejaba
 * al advisor en `fix_gate` sin salida (sin código cambiado, volver a correrlo tampoco aprueba).
 */
export function withoutSpecOnlyEvidence(s) {
  const failed = s.gate.failedStages || [];
  if (!s.gate.exists || failed.length !== 1 || failed[0] !== 'coherence') return s;
  return { ...s, gate: { exists: false, pending: s.gate.pending } };
}

/** Los hechos de una acción de rol de cadencia `spec`. */
export const specRoleFacts = (s, pending) => ({
  role: pending.role.id,
  cadence: 'spec',
  dir: s.specs.dir,
  fingerprint: s.specs.fingerprint,
  reviewDate: pending.entry?.date ?? null,
  findings: pending.entry?.findings ?? 0,
  memory: [],
  prior: priorFindings(s.review.entries, { role: pending.role.id, date: Infinity }),
  requirements: []
});

// Las filas de la etapa de spec en la tabla del advisor, en orden: problemas mecánicos, quien la revisa para su
// huella, y la aprobación, que solo da el usuario. No hay interruptor en `flow` que salte ninguna (R12).
export const SPEC_ROWS = [
  {
    action: 'fix_specs',
    when: (s) => !s.specs.dir || s.specs.problems.length > 0,
    facts: (s) => ({ dir: s.specs.dir || '', noSpec: s.specs.problem === 'no-spec', problems: s.specs.problems, author: specAuthor(s) })
  },
  {
    action: 'call_role',
    when: (s) => pendingSpecRole(s)?.entry === null,
    facts: (s) => specRoleFacts(s, pendingSpecRole(s))
  },
  {
    action: 'fix_review',
    when: (s) => !!pendingSpecRole(s)?.entry,
    facts: (s) => specRoleFacts(s, pendingSpecRole(s))
  },
  {
    action: 'approve_spec',
    when: (s) => !specApproved(s),
    facts: (s) => ({ dir: s.specs.dir, fingerprint: s.specs.fingerprint })
  }
];
