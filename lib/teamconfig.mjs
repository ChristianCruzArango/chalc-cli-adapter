// lib/teamconfig.mjs — la configuración inicial del equipo de un repo equipado (spec 034, R3).
// Responsabilidad ÚNICA: crear `.chalc/team.json` cuando no existe. Razón de cambio: los valores de partida.
//
// Es configuración del USUARIO: con qué agente y qué nivel de modelo corre cada rol. Por eso no se sobrescribe
// al re-equipar ni entra en el manifiesto de integridad. Los valores por defecto salen del propio orquestador.

import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadRoles } from './roles.mjs';
import { maxParallel, roleConfig } from '../catalog/team/lib/config.mjs';

export const TEAM_CONFIG_REL = '.chalc/team.json';

// Quien escribe el código recibe las skills equipadas; el resto las lee de sus propias instrucciones.
const withSkills = (id, skills) => (id === 'desarrollador' ? [...skills].sort() : []);

/** Crea `.chalc/team.json` en `projectPath` si falta. Devuelve si lo creó. */
export async function emitTeamConfig(projectPath, { skills = [] } = {}) {
  const file = join(projectPath, ...TEAM_CONFIG_REL.split('/'));
  if (existsSync(file)) return false;
  const roles = Object.fromEntries((await loadRoles()).map((role) => [role.id, { ...roleConfig({}, role.id), skills: withSkills(role.id, skills) }]));
  await mkdir(join(projectPath, '.chalc'), { recursive: true });
  await writeFile(file, JSON.stringify({ maxParallel: maxParallel({}), maxAttempts: 3, stallMinutes: 20, roles }, null, 2) + '\n', 'utf8');
  return true;
}
