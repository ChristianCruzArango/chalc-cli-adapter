// Contexto compartido del CLI: rutas del catálogo, argumentos parseados y estilo ANSI.
// `createContext(argv)` lo calcula de forma pura; al importar se expone el de `process.argv`.

import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { stdin } from 'node:process';
import { parseArgs } from '../args.mjs';
import { t } from '../i18n.mjs';
import { VERBS, verbOf } from './verbs.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const CHALC_ROOT = resolve(HERE, '../..');
export const CATALOG = join(CHALC_ROOT, 'catalog');
export const PROFILES_DIR = join(CATALOG, 'profiles');
export const RULES_DIR = join(CHALC_ROOT, 'rules');
export const METHODS_DIR = join(CATALOG, 'methods');
export const TARGETS_DIR = join(CHALC_ROOT, 'targets');

// ---------- helpers de ruta (los usa el propio cómputo de args) ----------
// Limpia una ruta escrita a mano: comillas envolventes, espacios y ~ → HOME.
// (un usuario suele pegar '/ruta con espacios' con comillas; sin esto, resolve() la trata como relativa)
export function cleanPath(p) {
  return p
    .trim()
    .replace(/^(['"])(.*)\1$/, '$2')   // quita comillas envolventes ' o "
    .replace(/\\ /g, ' ')               // espacios escapados \  →  espacio
    .replace(/^~(?=[/\\]|$)/, homedir())  // ~ → HOME del usuario (USERPROFILE en Windows)
    .trim();
}

export function looksLikePath(p) {
  const s = cleanPath(p);
  return s.startsWith('/') || s.startsWith('./') || s.startsWith('../') || s.startsWith('~/') ||
    s.includes('/') || s.includes('\\') || /^[a-zA-Z]:/.test(s);  // también rutas de Windows (\, C:\)
}

// Muestra una ruta con '/' para que la salida del CLI sea idéntica en cualquier SO.
export function disp(p) {
  return String(p).replace(/\\/g, '/');
}

// ---------- args ----------
// El contexto se calcula con una función PURA (R37, spec 016): no lee `process.argv` ni escribe nada,
// así se puede probar y reutilizar. Este módulo expone, como siempre, el resultado para `process.argv`.

// `flags` son las opciones de la línea de comandos y es de SOLO LECTURA (congelado): un comando que
// necesita otras para una etapa se las pasa a quien las use (ver `deliver` → `runQa`), en vez de
// escribir en el estado que comparten todos los módulos. Una flag mal escrita no tumba nada: el error
// se devuelve (`argError`) y el entrypoint lo muestra junto con la ayuda.
function parseCommandLine(argv) {
  try {
    const parsed = parseArgs(argv);
    return { argError: null, flags: Object.freeze(parsed.flags), positional: parsed.positional, warnings: parsed.warnings };
  } catch (e) {
    return { argError: e, flags: Object.freeze(Object.create(null)), positional: [], warnings: [] };
  }
}

// El proyecto sobre el que trabaja el verbo (regla del registro de verbos, M-04). `spec` toma su último
// argumento si parece una ruta; `debate` no lleva ruta (sus posicionales son la IDEA).
function projectOf(verb, positional, cwd) {
  const specArgs = verb === 'spec' ? positional.slice(1) : [];
  const last = specArgs.at(-1);
  const specProjectArg = specArgs.length > 1 && last && (existsSync(resolve(cwd, cleanPath(last))) || looksLikePath(last)) ? last : null;
  const rule = VERBS[verb].project;
  const projectArg = rule === null ? null : rule === 'spec' ? specProjectArg : positional[rule];
  return { specArgs, specProjectArg, projectArg, projectPath: resolve(cwd, projectArg || '.') };
}

// Una flag booleana repetida llega como array (`--dry-run --no-dry-run` → [true, false]); manda la
// ÚLTIMA, como en cualquier CLI. Antes el array, verdadero por ser array, activaba la flag (M-04).
const lastOf = (value) => (Array.isArray(value) ? value.at(-1) : value);

function switchesOf(flags, isTTY) {
  const assumeYes = !!lastOf(flags.yes) || !!lastOf(flags.y);
  return {
    dryRun: !!lastOf(flags['dry-run']),
    assumeYes,
    force: !!lastOf(flags.force),
    allowExternalExec: !!lastOf(flags['allow-exec']),
    methodFlags: flags.method ? [].concat(flags.method).map(String) : [],
    interactive: isTTY && !assumeYes
  };
}

// Todo lo que los comandos leen de la línea de comandos. `cwd` e `isTTY` son entradas explícitas.
export function createContext(argv, { cwd = process.cwd(), isTTY = !!stdin.isTTY } = {}) {
  const line = parseCommandLine(argv);
  const first = (line.positional[0] || '').toLowerCase();
  const verb = verbOf(first);   // del registro único de comandos (verbs.mjs, M-04)
  return {
    argv, ...line, first, verb,
    installSource: verb === 'install' ? line.positional[1] : null,
    ...projectOf(verb, line.positional, cwd),
    ...switchesOf(line.flags, isTTY)
  };
}

const context = createContext(process.argv.slice(2));
// Un secreto pasado por la línea de comandos queda en el historial y en `ps`: se avisa con la
// variable de entorno que hace lo mismo.
for (const w of context.warnings) process.stderr.write(`! --${w.flag}: ${t('secretFlagWarning', w.env)}\n`);
export const {
  argv, argError, flags, positional, first, verb, installSource, specArgs, specProjectArg,
  projectArg, projectPath, dryRun, assumeYes, force, allowExternalExec, methodFlags, interactive
} = context;

// ---------- estilo ----------
export { c } from '../ansi.mjs';
