// events.mjs — el vocabulario de eventos del equipo (spec 032, R3). Responsabilidad ÚNICA: qué eventos existen y
// qué datos lleva cada uno. Razón de cambio: lo que el orquestador registra.
//
// Este archivo lo emite chalc dentro de `.chalc/team/lib/`. No edites aquí: se regenera al equipar el repo.
//
// El estado (`status.json`) y el informe salen SOLO del registro, así que un evento mal formado no entra: un
// tipo inventado o un dato que falta se rechaza antes de escribir. Las claves van en inglés y no se traducen:
// es un contrato de datos entre el orquestador, los roles y el tablero.

/** Cada tipo de evento y sus campos obligatorios, además de `type` (y `at`, que pone el registro). */
export const EVENTS = Object.freeze({
  feature_opened: ['feature', 'agent'],
  spec_added: ['feature', 'spec'],
  spec_approved: ['spec'],
  scheduled: ['spec', 'wave'],
  started: ['spec', 'worktree', 'branch', 'launcher', 'tier'],
  // Una señal de vida de quien trabaja la spec; `phase` (RED|GREEN) y `task` son opcionales.
  signal: ['spec'],
  // Un rol despachado sobre la spec (spec 034): quién, y con qué lanzador y nivel.
  dispatched: ['spec', 'role', 'launcher', 'tier'],
  gate: ['spec', 'verdict'],
  delivered: ['spec', 'head'],
  reviewed: ['spec', 'role', 'ok', 'findings', 'summary'],
  rework: ['spec'],
  // Agotados los intentos, la spec se relanza UNA vez con el nivel de modelo siguiente (spec 034).
  relaunched: ['spec', 'tier'],
  escalated: ['spec', 'reason'],
  blocked: ['spec', 'reason'],
  unblocked: ['spec'],
  integrated: ['spec', 'head'],
  lead: ['feature', 'action'],
  needs_human: ['feature', 'reason', 'command'],
  human_done: ['feature'],
  closed: ['feature']
});

// Falta lo que no vino o vino en blanco. `false` y `0` son datos.
const missing = (value) => value === undefined || value === null || (typeof value === 'string' && value.trim() === '');

/** Por qué `event` no se puede registrar: '' si vale, `unknown-type` o `missing:<campo>`. */
export function eventProblem(event) {
  const fields = event && typeof event === 'object' ? EVENTS[event.type] : undefined;
  if (!fields) return 'unknown-type';
  const absent = fields.find((field) => missing(event[field]));
  return absent ? `missing:${absent}` : '';
}
