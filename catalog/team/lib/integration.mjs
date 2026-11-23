// integration.mjs — la rama donde se une lo aprobado de una feature (spec 035, R1, R4, R5). Responsabilidad
// ÚNICA: crear esa rama en su worktree y unirle la rama de una spec. Razón de cambio: cómo se une.
//
// Este archivo lo emite chalc dentro de `.chalc/team/lib/`. No edites aquí: se regenera al equipar el repo.
//
// Nadie une nada en la rama del usuario: todo va a `chalc/int-<feature>`, en un worktree aparte. La evidencia
// del portón la escriben todas las ramas en los mismos archivos; eso no es un conflicto de trabajo y git la
// une solo. Cualquier otro choque sí lo es: se aborta y decide una persona.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { evidenceMerges } from './evidencemerge.mjs';
import { git } from './git.mjs';
import { worktreesBase } from './places.mjs';

/** La rama de integración de `feature`. */
export const intBranch = (feature) => `chalc/int-${feature}`;
/** ¿Existe ya la rama de integración de `feature`? */
export const hasIntegration = (root, feature) => git(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${intBranch(feature)}`]).ok;
/** La carpeta del worktree de integración de `feature`. */
export const intDir = async (root, feature) => join(await worktreesBase(root), `int-${feature}`);

/** Deja listo el worktree de integración de `feature` sobre `base`. Devuelve { ok, dir, err }. */
export async function ensureIntegration(root, feature, base) {
  const dir = await intDir(root, feature);
  await evidenceMerges(root);
  if (existsSync(dir)) return { ok: true, dir, err: '' };
  const added = hasIntegration(root, feature)
    ? git(root, ['worktree', 'add', '-q', dir, intBranch(feature)])
    : git(root, ['worktree', 'add', '-q', '-b', intBranch(feature), dir, base]);
  return { ok: added.ok, dir, err: added.err };
}

/** Une `branch` en el worktree `dir`. Devuelve { ok, before, conflicts }: con conflicto, la unión se aborta. */
export function mergeSpec(dir, branch) {
  const before = git(dir, ['rev-parse', 'HEAD']).out;
  if (git(dir, ['merge', '--no-ff', '--no-edit', branch]).ok) return { ok: true, before, conflicts: [] };
  const conflicts = git(dir, ['diff', '--name-only', '--diff-filter=U']).out.split(/\r?\n/).filter(Boolean);
  git(dir, ['merge', '--abort']);
  return { ok: false, before, conflicts };
}
