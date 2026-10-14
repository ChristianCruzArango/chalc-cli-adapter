// dashboard.mjs — lo que el tablero resume de un vistazo (spec 020, R17, R18, R20). Responsabilidad ÚNICA:
// sacar de la vista ya armada los indicadores, el flujo SDD, las specs y las notas de los roles. Razón de
// cambio: qué se resume arriba. Puro: recibe la vista y los textos que leyó el servidor.
//
// Este archivo lo emite chalc dentro de `.chalc/live/lib/`. No edites aquí: se regenera al equipar.

import { reviewNotes, taskAt } from './notes.mjs';
import { phasesOf, specsOf } from './sdd.mjs';

// La spec de la que salen las tareas: la de `tasks.md` vigente o, si aún no hay tareas, la más reciente.
const sourceOf = (specs, feature) => specs.find((s) => s.dir === feature) || (feature ? null : specs[0]) || null;

// La frase titular (R21), armada con datos: la página la escribe en el idioma del proyecto.
function headlineOf(view, action) {
  const index = view.tasks.findIndex((t) => t.current);
  return {
    task: index < 0 ? '' : view.tasks[index].id, index: index + 1, total: view.tasks.length,
    verdict: view.gate.verdict, verdictText: view.gate.verdictText,
    failing: view.gate.stages.filter((s) => s.result === 'failed' || s.result === 'blocked').map((s) => s.title),
    action, role: view.next.role
  };
}

/** Indicadores, flujo, specs y notas a partir de la vista (`view`) y de lo leído del repo. */
export function dashboardOf(view, { reviewText, specFiles, constitution, action }) {
  const specs = specsOf(specFiles, view.feature);
  const source = sourceOf(specs, view.feature);
  return {
    headline: headlineOf(view, action),
    kpis: {
      tasks: view.progress, verdict: view.gate.verdict, verdictText: view.gate.verdictText,
      tokens: view.totals.tokens.total, ms: view.totals.ms,
      roles: { ok: view.roles.filter((r) => r.status === 'ok').length, total: view.roles.length }
    },
    source: { dir: source?.dir || '', title: source?.title || '' },
    specs,
    flow: phasesOf({ constitution, spec: source, gate: view.gate, roles: view.roles, action }),
    notes: reviewNotes(reviewText).map((note) => ({ ...note, task: taskAt(note.at, view.activity) }))
  };
}
