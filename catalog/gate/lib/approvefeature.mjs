// approvefeature.mjs — la aprobación del CIERRE por el usuario (spec 028, R2, R3). Responsabilidad ÚNICA: decidir
// si el cierre de la carpeta activa se puede sellar, y sellarlo. Razón de cambio: las condiciones de un cierre.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// Es la segunda y última puerta humana de una feature. Aprueba una PERSONA, con una terminal interactiva y
// tecleando el nombre de la carpeta, sobre algo que se puede comprobar: la spec aprobada, todas las tareas
// marcadas y una corrida COMPLETA del portón que aprueba. El orden fino (roles, evidencia vigente) lo lleva el
// advisor; aquí están las condiciones sin las que ningún cierre tiene sentido.

import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { logApproval } from './approvals.mjs';
import { headCommit } from './changed.mjs';
import { STATE_REL } from './evidence.mjs';
import { specFacts } from './specfacts.mjs';
import { tasksIn } from './specparse.mjs';
import { writeSeal } from './specseal.mjs';

const TICKED = /^\s*[-*]\s+\[[xX]\]/;

// El último estado del portón, o null si no hay o no se puede leer.
async function gateState(root) {
  try {
    const state = JSON.parse(await readFile(join(root, ...STATE_REL.split('/')), 'utf8'));
    return state && typeof state === 'object' && !Number.isNaN(Date.parse(state.date)) ? state : null;
  } catch { return null; }
}

const allTicked = (tasks) => {
  const items = tasksIn(tasks ?? '');
  return items.length > 0 && items.every(({ text }) => TICKED.test(text));
};

// Lo que impide el cierre, en el orden en que tiene sentido arreglarlo; '' si nada.
function blocker(facts, state) {
  if (!facts.dir) return 'no-spec';
  if (facts.problems.length || !facts.approved) return 'spec-not-approved';
  if (!allTicked(facts.files['tasks.md'])) return 'tasks-open';
  if (!state) return 'no-evidence';
  if (state.verdict !== 'pass') return 'evidence-not-pass';
  // Una corrida rápida omite la mutación a propósito: su verde no cierra nada.
  return state.fast === false ? '' : 'evidence-fast';
}

/**
 * Sella el cierre de la carpeta activa. opts: { specDir, isTTY, ask(nombre), now(), head(root) }.
 * Devuelve { ok, reason, dir, file }; reason: '' | no-spec | spec-not-approved | tasks-open | no-evidence |
 * evidence-not-pass | evidence-fast | no-terminal | name-mismatch.
 */
export async function approveFeature(root, { specDir = 'specs', isTTY = false, ask, now = () => new Date(), head = headCommit } = {}) {
  const facts = await specFacts(root, specDir);
  const state = await gateState(root);
  const refused = (reason) => ({ ok: false, reason, dir: facts.dir, file: '' });
  const reason = blocker(facts, state);
  if (reason) return refused(reason);
  if (!isTTY) return refused('no-terminal');
  const name = basename(facts.dir);
  if (String(await ask(name)).trim() !== name) return refused('name-mismatch');
  const seal = { dir: facts.dir, fingerprint: facts.fingerprint, evidence: state.date, head: (await head(root)) || '', date: now().toISOString() };
  const file = await writeSeal(root, seal, 'feature');
  await logApproval(root, { kind: 'feature', ...seal });
  return { ok: true, reason: '', dir: facts.dir, file };
}
