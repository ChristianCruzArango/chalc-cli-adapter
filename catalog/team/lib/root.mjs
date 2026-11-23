// root.mjs — de qué repo es el equipo (spec 032, R2). Responsabilidad ÚNICA: resolver la raíz donde vive el
// registro. Razón de cambio: cómo se localiza el repo principal.
//
// Este archivo lo emite chalc dentro de `.chalc/team/lib/`. No edites aquí: se regenera al equipar el repo.
//
// Cada spec se trabaja en su worktree, pero el equipo es UNO: el registro y el estado viven en el repo
// principal. Desde un worktree, git sabe cuál es (`--git-common-dir` apunta a su `.git`).

import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';

// La carpeta equivalente a `cwd` en el repo principal, o '' si `cwd` no está en un repo de git. Se conserva la
// subcarpeta (spec 036, R2): un proyecto equipado dentro de un monorepo sigue siendo ESA subcarpeta.
function commonRoot(cwd) {
  const out = spawnSync('git', ['rev-parse', '--git-common-dir', '--show-prefix'], { cwd, encoding: 'utf8', windowsHide: true });
  if (out.status !== 0) return '';
  const [gitDir = '', prefix = ''] = out.stdout.split(/\r?\n/).map((line) => line.trim());
  return gitDir ? join(dirname(resolve(cwd, gitDir)), ...prefix.split('/').filter(Boolean)) : '';
}

/** La raíz del equipo: la de `--root <ruta>`, la del repo principal, o `cwd` si no hay git. */
export function mainRoot(cwd, argv = []) {
  const index = argv.indexOf('--root');
  if (index >= 0 && argv[index + 1]) return resolve(cwd, argv[index + 1]);
  return commonRoot(cwd) || cwd;
}
