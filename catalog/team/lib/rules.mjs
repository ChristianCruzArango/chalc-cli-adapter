// rules.mjs — las reglas propias del proyecto que recibe cada rol (spec 034, R5). Responsabilidad ÚNICA: decir
// qué archivos de reglas EXISTEN en la carpeta donde trabaja el rol. Razón de cambio: qué se considera una regla.
//
// Este archivo lo emite chalc dentro de `.chalc/team/lib/`. No edites aquí: se regenera al equipar el repo.
//
// Las reglas de quien mantiene el repo mandan sobre las costumbres de cualquier rol, las escriba para el
// asistente que las escriba. Solo se nombran las que existen: una orden que cita un archivo que no está enseña a ignorarla.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fixedPrefix } from './scope.mjs';

const AT_ROOT = Object.freeze(['CLAUDE.md', 'AGENTS.md', '.github/copilot-instructions.md', '.cursor/rules']);
const NESTED = Object.freeze(['CLAUDE.md', 'AGENTS.md']);

// Las carpetas que llevan a lo que la spec toca: `src/pagos/**` → `src`, `src/pagos`.
function foldersOf(touches) {
  const folders = new Set();
  for (const touch of touches) fixedPrefix(touch).forEach((_, depth, parts) => folders.add(parts.slice(0, depth + 1).join('/')));
  return [...folders].sort();
}

/** Los archivos de reglas que existen en `dir`: los de la raíz y los anidados en las carpetas de `touches`. */
export function projectRules(dir, touches = []) {
  const candidates = [...AT_ROOT, ...foldersOf(touches).flatMap((folder) => NESTED.map((name) => `${folder}/${name}`))];
  return candidates.filter((rel) => existsSync(join(dir, ...rel.split('/'))));
}
