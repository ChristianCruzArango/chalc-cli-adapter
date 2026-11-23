// git.mjs — la única puerta a git del equipo (spec 033). Responsabilidad ÚNICA: correr un comando de git y
// devolver si funcionó y qué dijo. Razón de cambio: cómo se invoca git.
//
// Este archivo lo emite chalc dentro de `.chalc/team/lib/`. No edites aquí: se regenera al equipar el repo.
//
// Sin shell: los argumentos van como lista, así que nada de lo que traiga una ruta o un nombre se interpreta.

import { spawnSync } from 'node:child_process';

/** Corre `git <args>` en `cwd`. Devuelve { ok, out } con la salida sin espacios sobrantes. */
export function git(cwd, args) {
  const run = spawnSync('git', ['-c', 'core.quotepath=false', ...args], { cwd, encoding: 'utf8', windowsHide: true });
  return { ok: run.status === 0, out: String(run.stdout || '').trim(), err: String(run.stderr || '').trim() };
}
