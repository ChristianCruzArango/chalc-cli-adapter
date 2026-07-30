// lib/gitworktree.mjs — creación CONSERVADORA de worktrees para el modo workspace (spec 005).
// Responsabilidad única: montar un worktree de un repo en una ruta destino sobre una rama de
// feature (nueva o existente). NUNCA ejecuta remove, prune ni --force: deshacer es del usuario.

import { existsSync } from 'node:fs';
import { git, gitStatus } from './gitprep.mjs';

// Monta un worktree de repoDir en destPath sobre `branch`. Si la rama no existe la crea (-b);
// si existe, la reusa (sin --force). Devuelve { ok, reason }.
// reason ∈ 'created' | 'created-existing-branch' | 'not-a-repo' | 'dest-exists' | 'add-failed'.
export async function addWorktree(repoDir, destPath, branch) {
  if (!(await gitStatus(repoDir)).isRepo) return { ok: false, reason: 'not-a-repo' };
  if (existsSync(destPath)) return { ok: false, reason: 'dest-exists' };
  const branchExists = (await git(['rev-parse', '--verify', '--quiet', branch], repoDir)).code === 0;
  const args = branchExists
    ? ['worktree', 'add', destPath, branch]
    : ['worktree', 'add', '-b', branch, destPath];
  const added = await git(args, repoDir);
  if (added.code !== 0) return { ok: false, reason: 'add-failed' };
  return { ok: true, reason: branchExists ? 'created-existing-branch' : 'created' };
}
