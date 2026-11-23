// evidence.mjs — lo que respalda una entrega (spec 034, R9). Responsabilidad ÚNICA: leer del worktree si las
// tareas están hechas y si el portón aprobó ESE código. Razón de cambio: qué evidencia se exige para entregar.
//
// Este archivo lo emite chalc dentro de `.chalc/team/lib/`. No edites aquí: se regenera al equipar el repo.
//
// «Ya pasé el portón» no es evidencia: lo es el estado que el portón dejó escrito, atado al commit que midió.
// Un commit de código posterior a esa corrida la deja vieja, aunque en su día saliera verde.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { firstOpenTask } from '../../gate/lib/specparse.mjs';
import { git } from './git.mjs';
import { inScope } from './scope.mjs';

/** La evidencia que el portón y los roles dejan en el repo: toda spec puede tocarla. */
export const EVIDENCE = Object.freeze(['.chalc/gate.md', '.chalc/gate.state.json', '.chalc/review.md', '.chalc/tdd.jsonl']);

const textOr = async (path) => { try { return await readFile(path, 'utf8'); } catch { return ''; } };

/** ¿Queda alguna tarea sin marcar en el `tasks.md` de `spec`? Sin archivo, sí: no hay nada hecho que entregar. */
export async function hasOpenTasks(dir, spec) {
  const tasks = await textOr(join(dir, ...spec.split('/'), 'tasks.md'));
  return !tasks.trim() || Boolean(firstOpenTask(tasks));
}

/** ¿Lo único que cambió desde `head` (el commit que se midió) es evidencia y la propia spec (marcar tareas)? */
export function onlyEvidenceSince(dir, spec, head) {
  const diff = head ? git(dir, ['diff', '--name-only', head, 'HEAD']) : { ok: false, out: '' };
  return diff.ok && diff.out.split(/\r?\n/).filter(Boolean).every((file) => inScope(file, [spec, ...EVIDENCE]));
}

/** La corrida del portón que respalda lo que hay en `dir`: { verdict, score, fast }, o null si no hay ninguna válida. */
export async function passedGate(dir, spec) {
  let state = null;
  try { state = JSON.parse(await textOr(join(dir, '.chalc', 'gate.state.json'))); } catch { return null; }
  if (!state || state.verdict !== 'pass' || state.fast !== false || !onlyEvidenceSince(dir, spec, state.head)) return null;
  const mutation = (Array.isArray(state.stages) ? state.stages : []).find((stage) => typeof stage?.score === 'number');
  return { verdict: 'pass', fast: false, score: mutation ? mutation.score : null };
}
