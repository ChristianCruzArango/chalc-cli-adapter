// places.mjs — dónde van los worktrees del equipo (specs 033, 035). Responsabilidad ÚNICA: resolver esa carpeta.
// Razón de cambio: dónde se guarda el trabajo en curso.
//
// Este archivo lo emite chalc dentro de `.chalc/team/lib/`. No edites aquí: ajusta `.chalc/team.json`.
//
// Fuera del repo, en una carpeta hermana: un worktree dentro del propio repo aparecería como archivos sin seguimiento.

import { readFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

/** La carpeta donde van los worktrees: la de `worktreesDir` en `.chalc/team.json`, o una hermana del repo. */
export async function worktreesBase(root) {
  let dir = '';
  try { dir = JSON.parse(await readFile(join(root, '.chalc', 'team.json'), 'utf8')).worktreesDir || ''; } catch { /* sin archivo */ }
  return typeof dir === 'string' && dir.trim() ? resolve(root, dir) : join(dirname(root), `${basename(root)}.chalc-wt`);
}
