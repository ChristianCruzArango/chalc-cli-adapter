// lib/guardemit.mjs — la guarda en disco: `.claude/settings.local.json` (spec 023, R1, R3, R4, R6, R7, R15).
// Responsabilidad ÚNICA: leer el archivo local del asistente, aplicarle la fusión pura de `guardsettings.mjs`
// y escribirlo. Razón de cambio: dónde y cómo se guarda la guarda. No decide si toca ni imprime nada: eso es
// `commands/guardstep.mjs`.
//
// Solo el archivo LOCAL: `.claude/settings.json` va commiteado, y activar ahí un hook se lo impondría a todo
// el que clone el repo (R6). Claude Code saca el local de git solo cuando lo crea él; si lo crea chalc, lo
// nombra el `.gitignore` (R7). Lo que no se entiende —JSON inválido, otra forma, una carpeta o un enlace en
// su lugar— se deja tal cual (R4): nunca se sobrescribe configuración del usuario que no se pudo leer.

import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { withGuard, withoutGuard } from './guardsettings.mjs';
import { GUARD_STATUS } from './guardstatus.mjs';
import { ensureIgnored } from './gitignore-local.mjs';
import { t } from './i18n.mjs';

/** El archivo local tal como lo nombra el `.gitignore` (siempre con `/`). */
export const GUARD_IGNORE = '.claude/settings.local.json';

const settingsPath = (projectPath) => join(projectPath, '.claude', 'settings.local.json');

const MISSING = Symbol('missing');

const lstatOrNull = (path) => lstat(path).catch(() => null);

// El objeto del archivo; MISSING si no existe y se puede crear; null si no se puede leer como settings. Se mira
// con `lstat`: en Windows una carpeta se lee vacía en vez de fallar, y un enlace no se sigue. Si el archivo no
// está, manda la carpeta: un `.claude` que es un archivo da ENOTDIR en POSIX pero ENOENT en Windows.
async function readSettings(path) {
  const stats = await lstatOrNull(path);
  if (!stats) {
    const folder = await lstatOrNull(dirname(path));
    return !folder || folder.isDirectory() ? MISSING : null;
  }
  if (!stats.isFile()) return null;
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; }
}

async function writeSettings(path, settings) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}

/** Activa la guarda en el archivo local y lo saca de git: `added`, `unchanged` o `invalid`. */
export async function enableGuard(projectPath) {
  const path = settingsPath(projectPath);
  const current = await readSettings(path);
  const result = withGuard(current === MISSING ? {} : current);
  if (!result) return GUARD_STATUS.invalid;
  if (result.changed) await writeSettings(path, result.settings);
  await ensureIgnored(projectPath, [GUARD_IGNORE], t('gitignoreGuardHeader'));
  return result.changed ? GUARD_STATUS.added : GUARD_STATUS.unchanged;
}

/** Quita lo que chalc añadió; si no queda nada, borra el archivo: `removed`, `absent` o `invalid`. */
export async function disableGuard(projectPath) {
  const path = settingsPath(projectPath);
  const current = await readSettings(path);
  if (current === MISSING) return GUARD_STATUS.absent;
  const result = withoutGuard(current);
  if (!result) return GUARD_STATUS.invalid;
  if (!result.changed) return GUARD_STATUS.absent;
  if (Object.keys(result.settings).length) await writeSettings(path, result.settings);
  else await rm(path);
  return GUARD_STATUS.removed;
}
