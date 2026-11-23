// runtests.mjs — correr un comando del proyecto en una carpeta (spec 035). Responsabilidad ÚNICA: ejecutar el
// comando de pruebas (o el de preparación) y decir si salió bien. Razón de cambio: cómo se lanza ese comando.
//
// Este archivo lo emite chalc dentro de `.chalc/team/lib/`. No edites aquí: se regenera al equipar el repo.
//
// El comando es el que el usuario dejó en su configuración, no texto que llegue de un rol: por eso pasa por la
// shell, igual que cuando lo corre el portón. Su salida no se muestra: aquí solo importa si la unión pasa.

import { spawnSync } from 'node:child_process';

/** ¿Termina `command` con código 0 en `cwd`? Un comando vacío no se corre y cuenta como bien. */
export function runsOk(command, cwd) {
  if (!String(command ?? '').trim()) return true;
  return spawnSync(command, { cwd, shell: true, stdio: 'ignore', windowsHide: true }).status === 0;
}
