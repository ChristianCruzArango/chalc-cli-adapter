// sdd.mjs — el flujo SDD de la feature y las specs del proyecto (spec 020, R20). Responsabilidad ÚNICA: decir
// en qué fase del método va la feature y de qué spec salen sus tareas. Razón de cambio: las fases del método.
// Puro: quien lee las carpetas de `specs/` es el servidor.
//
// Este archivo lo emite chalc dentro de `.chalc/live/lib/`. No edites aquí: se regenera al equipar.
//
// Las cuatro primeras fases van en orden —constitución, spec, plan, tareas—: la primera que falta es la que
// está en curso y las siguientes esperan. Las otras cuatro son el bucle de cada tarea —implementación (TDD +
// mutación), portón, roles, cierre— y cada una dice su propio estado en cuanto hay tareas.

import { taskList } from '../../next/lib/tasks.mjs';

const nameOf = (dir) => dir.split('/').pop();
const titleOf = (text, dir) => String(text ?? '').match(/^#\s+(?:Spec:\s*)?(.+)$/m)?.[1].trim() || nameOf(dir);
const requirementsIn = (text) => new Set([...String(text ?? '').matchAll(/\*\*R(\d+)\*\*/g)].map((m) => m[1])).size;

function progressOf(text) {
  const tasks = taskList(text);
  return { done: tasks.filter((t) => t.done).length, total: tasks.length };
}

/** Cada carpeta de spec, tal como llega (la más reciente primero), con lo que se sabe de ella. */
export function specsOf(files, feature) {
  return (files || []).map((f) => ({
    dir: f.dir, name: nameOf(f.dir), title: titleOf(f.spec, f.dir), requirements: requirementsIn(f.spec),
    plan: !!f.plan, tasks: progressOf(f.tasks), current: f.dir === feature
  }));
}

const SEQUENTIAL = ['constitution', 'spec', 'plan', 'tasks'];

function rolesState(roles) {
  if (roles.some((r) => r.status === 'findings')) return 'failed';
  return roles.every((r) => r.status === 'ok') ? 'done' : 'current';
}

function gateState(verdict) {
  if (verdict === 'pass') return 'done';
  return verdict === 'fail' || verdict === 'blocked' ? 'failed' : 'pending';
}

// El estado de las fases del bucle de cada tarea, cuando ya hay tareas.
function loopStates({ spec, gate, roles, action }) {
  const { done, total } = spec.tasks;
  return { implement: done === total ? 'done' : 'current', gate: gateState(gate.verdict), roles: rolesState(roles), close: action === 'done' ? 'done' : 'pending' };
}

function detailsOf({ spec, gate, roles }) {
  const total = spec?.tasks?.total || 0;
  return {
    constitution: '', plan: '', close: '',
    spec: spec ? { n: spec.requirements } : '',
    tasks: total ? { n: total } : '',
    implement: total ? { done: spec.tasks.done, total } : '',
    gate: gate.verdict && gate.verdict !== 'none' ? { text: gate.verdictText } : '',
    roles: roles.length ? { done: roles.filter((r) => r.status === 'ok').length, total: roles.length } : ''
  };
}

/** Las ocho fases del método para la feature en curso, en orden, con su estado y su detalle. */
export function phasesOf({ constitution, spec, gate, roles, action }) {
  const have = { constitution: !!constitution, spec: !!spec, plan: !!spec?.plan, tasks: (spec?.tasks?.total || 0) > 0 };
  // La primera fase secuencial que falta: antes de ella todo está hecho, ella en curso, y lo demás espera.
  const at = SEQUENTIAL.findIndex((id) => !have[id]);
  const states = Object.fromEntries(SEQUENTIAL.map((id, i) => [id, at < 0 || i < at ? 'done' : i === at ? 'current' : 'pending']));
  Object.assign(states, at < 0 ? loopStates({ spec, gate, roles, action }) : { implement: 'pending', gate: 'pending', roles: 'pending', close: 'pending' });
  const details = detailsOf({ spec, gate, roles });
  return [...SEQUENTIAL, 'implement', 'gate', 'roles', 'close'].map((id) => ({ id, state: states[id], detail: details[id] }));
}
