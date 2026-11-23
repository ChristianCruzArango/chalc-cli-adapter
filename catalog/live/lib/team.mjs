// team.mjs — el equipo en el tablero (spec 032, R13). Responsabilidad ÚNICA: reducir el estado del equipo a lo
// que la página pinta. Razón de cambio: qué se ve del equipo. Puro: recibe el estado ya calculado.
//
// Este archivo lo emite chalc dentro de `.chalc/live/lib/`. No edites aquí: se regenera al equipar.
//
// No interpreta nada: son los mismos datos de `.chalc/team/status.json`, ya recortados a una fila por spec.

import { gateCell } from '../../team/lib/render.mjs';

const gateText = (gate) => (gate ? gateCell(gate) : '');
// Lo que explica por qué una spec no avanza: su bloqueo o, si la rechazaron, el último hallazgo.
const noteOf = (spec) => spec.blockedBy || (spec.state === 'rejected' ? spec.lastFinding : '');

const specRow = (spec) => ({
  spec: spec.spec, state: spec.state,
  developer: [spec.developer.launcher, spec.developer.tier].filter(Boolean).join(' · '),
  phase: spec.phase, task: spec.task, attempt: `${spec.attempt}/${spec.maxAttempts}`,
  gate: gateText(spec.lastGate), note: noteOf(spec), stalled: spec.stalled
});

/** El equipo para la página, o null si no hay ninguna feature registrada. */
export function teamOf(status) {
  if (!status?.features?.length) return null;
  return {
    waiting: status.waitingHuman.map(({ feature, reason, command }) => ({ feature, reason, command })),
    features: status.features.map((f) => ({ feature: f.feature, agent: f.lead.agent, action: f.lead.action, closed: f.closed, specs: f.specs.map(specRow) }))
  };
}
