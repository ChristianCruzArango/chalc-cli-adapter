// lib/rolesemit.mjs — las instrucciones de cada rol dentro del repo equipado (spec 034, R2).
// Responsabilidad ÚNICA: escribir `.chalc/roles/<rol>.md`. Razón de cambio: dónde viven las instrucciones neutras.
//
// Cada asistente recibe los roles a su manera (`.claude/agents/`, un bloque en AGENTS.md…). Esta copia no es de
// ninguno: es la que nombra la orden de despacho, para que un rol lanzado con OTRO agente lea lo mismo.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRoles } from './roles.mjs';
import { roleText } from './targetkit/roles.mjs';

const CATALOG = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'catalog');

/** Dónde quedan las instrucciones de `id`, con '/'. */
export const roleFileRel = (id) => `.chalc/roles/${id}.md`;

/** Escribe las instrucciones de todos los roles en `projectPath`. Devuelve { written }. */
export async function emitRoles(projectPath, { skills = [], specLang = '' } = {}) {
  const written = [];
  for (const role of await loadRoles()) {
    const { text } = await roleText(CATALOG, role, { skills, specLang });
    const dest = join(projectPath, ...roleFileRel(role.id).split('/'));
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, text, 'utf8');
    written.push(roleFileRel(role.id));
  }
  return { written };
}
