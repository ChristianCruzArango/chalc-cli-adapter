// lib/gitignore-local.mjs — los artefactos LOCALES de `.chalc/` fuera de git (spec 022, R14). Responsabilidad
// ÚNICA: que el `.gitignore` de un repo equipado los nombre, exista ya o no. Razón de cambio: qué escribe en
// `.chalc/` el tooling emitido que es de esta máquina y de esta sesión.
//
// `init-gitignore.mjs` solo escribe un `.gitignore` cuando el proyecto no tiene ninguno; en un repo que ya
// existía no añadía nada, y `live.json` (puerto y pid del tablero) acababa commiteado —y el tablero de otro
// se lo creía—. Aquí solo se AÑADE lo que falta, una vez, al final: lo del usuario no se toca.

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { t } from './i18n.mjs';

/** Lo que el tablero, el candado del acumulado y la memoria escriben en `.chalc/` y no debe versionarse. */
export const LOCAL_IGNORES = Object.freeze([
  '.chalc/live.json', '.chalc/activity.jsonl', '.chalc/usage.json', '.chalc/usage.lock/', '.chalc/memory/state.json'
]);

// Una línea que ya ignora la carpeta entera vale por todas.
const WHOLE_FOLDER = new Set(['.chalc', '.chalc/', '/.chalc', '/.chalc/', '.chalc/*', '.chalc/**']);

// La forma de comparar una línea: sin espacios, sin `/` inicial, y `usage.lock` igual a `usage.lock/`.
const norm = (line) => line.trim().replace(/^\//, '').replace(/\/$/, '');

/** Añade al `.gitignore` de `projectPath` las entradas que falten. Devuelve si lo cambió. */
export async function ensureLocalIgnores(projectPath) {
  const path = join(projectPath, '.gitignore');
  const text = await readFile(path, 'utf8').catch(() => '');
  const present = text.split(/\r?\n/);
  if (present.some((line) => WHOLE_FOLDER.has(line.trim()))) return false;
  const have = new Set(present.map(norm));
  const missing = LOCAL_IGNORES.filter((entry) => !have.has(norm(entry)));
  if (!missing.length) return false;
  const glue = text && !text.endsWith('\n') ? '\n' : '';
  const gap = text ? '\n' : '';
  await writeFile(path, `${text}${glue}${gap}# ${t('gitignoreLocalHeader')}\n${missing.join('\n')}\n`, 'utf8');
  return true;
}
