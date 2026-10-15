// lib/gitignore-local.mjs — los artefactos LOCALES de un repo equipado fuera de git (spec 022, R14; spec 023,
// R7). Responsabilidad ÚNICA: que el `.gitignore` los nombre, exista ya o no. Razón de cambio: qué escribe el
// tooling emitido que es de esta máquina y de esta sesión (`.chalc/`, y la guarda en `.claude/settings.local.json`).
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

// La forma de comparar una línea: sin espacios, sin `/` inicial, y `usage.lock` igual a `usage.lock/`.
const norm = (line) => line.trim().replace(/^\//, '').replace(/\/$/, '');

// Las líneas que ya ignoran `entry`: ella misma o cualquiera de sus carpetas, también como `carpeta/*` o
// `carpeta/**`. Una línea con `.chalc/` entero vale así por todas las entradas de dentro, y no por las de fuera.
function coveringLines(entry) {
  const parts = norm(entry).split('/');
  const folders = parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'));
  return [norm(entry), ...folders.flatMap((folder) => [folder, `${folder}/*`, `${folder}/**`])];
}

/** Añade al `.gitignore` de `projectPath`, bajo `header`, las `entries` que falten. Devuelve si lo cambió. */
export async function ensureIgnored(projectPath, entries, header) {
  const path = join(projectPath, '.gitignore');
  const text = await readFile(path, 'utf8').catch(() => '');
  const have = new Set(text.split(/\r?\n/).map(norm));
  const missing = entries.filter((entry) => !coveringLines(entry).some((line) => have.has(line)));
  if (!missing.length) return false;
  const glue = text && !text.endsWith('\n') ? '\n' : '';
  const gap = text ? '\n' : '';
  await writeFile(path, `${text}${glue}${gap}# ${header}\n${missing.join('\n')}\n`, 'utf8');
  return true;
}

/** Añade al `.gitignore` de `projectPath` los artefactos locales de `.chalc/` que falten. Devuelve si lo cambió. */
export function ensureLocalIgnores(projectPath) {
  return ensureIgnored(projectPath, LOCAL_IGNORES, t('gitignoreLocalHeader'));
}
