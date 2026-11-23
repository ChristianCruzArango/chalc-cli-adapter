// reviewers.mjs — quién revisa una entrega (spec 034). Responsabilidad ÚNICA: leer del portón los roles de
// revisión que el proyecto exige. Razón de cambio: de dónde sale la lista de revisores.
//
// Este archivo lo emite chalc dentro de `.chalc/team/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// No hay una segunda lista: son los mismos roles que el advisor pide al cerrar cada tarea (`flow.roles`, cadencia
// `task`), en su orden. En el equipo pasan una vez por ENTREGA, sobre el commit entregado.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Los ids de los roles exigidos en `root` con esa cadencia (`task`, `feature`), en orden. Sin configuración, ninguno. */
export async function rolesOf(root, cadence) {
  let roles = [];
  try { roles = JSON.parse(await readFile(join(root, '.chalc', 'gate.json'), 'utf8')).flow?.roles || []; } catch { /* sin portón */ }
  return (Array.isArray(roles) ? roles : [])
    .filter((role) => role && role.cadence === cadence && role.required !== false)
    .sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity))
    .map((role) => role.id);
}

/** Los roles que revisan cada ENTREGA: los de cadencia `task`. */
export const reviewRoles = (root) => rolesOf(root, 'task');
