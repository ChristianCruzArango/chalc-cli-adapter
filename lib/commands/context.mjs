// Contexto compartido del CLI: rutas del catálogo, argumentos parseados y estilo ANSI.
// Se computa UNA vez al importar (desde process.argv) y todos los comandos leen de aquí.

import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { stdin } from 'node:process';
import { parseArgs } from '../args.mjs';

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
export const argv = process.argv.slice(2);
// `flags` es UN ÚNICO objeto compartido: withTemporaryFlags (deliver) lo muta y restaura,
// y el resto de módulos deben ver esas mutaciones a través de este binding.
const parsed = parseArgs(argv);
export const flags = parsed.flags;
export const positional = parsed.positional;
export const first = (positional[0] || '').toLowerCase();

// Resolución del verbo por TABLA de aliases (mismo comportamiento que la cadena ternaria original).
const VERB_ALIASES = {
  lang: ['lang', 'config-lang', 'idioma', 'language'],
  init: ['init', 'new', 'create'],
  install: ['install', 'add'],
  inspect: ['inspect', 'explain'],
  verify: ['verify', 'check', 'audit'],
  doctor: ['doctor'],
  configure: ['configure', 'config', 'setup'],
  ai: ['config-ia', 'config-ai', 'configia', 'ai', 'provider'],
  aidoctor: ['ai-doctor', 'doctor-ia'],
  aieval: ['eval-ia', 'eval-ai', 'ai-eval'],
  specgen: ['spec-ia', 'spec-ai', 'spec-gen', 'specgen', 'gen'],
  feature: ['feature', 'hu', 'fullstack'],
  spec: ['spec', 'specs'],
  qa: ['qa', 'quality'],
  deliver: ['deliver', 'delivery'],
  tokens: ['tokens', 'cost', 'costs', 'costes', 'gasto'],
  update: ['update', 'upgrade', 'sync'],
  dashboard: ['dashboard', 'dash', 'monitor'],
  debate: ['debate', 'model', 'models', 'debatir']
};
// Mapa invertido alias → verbo; cualquier otra cosa cae al default 'apply'.
const ALIAS_TO_VERB = Object.fromEntries(
  Object.entries(VERB_ALIASES).flatMap(([v, aliases]) => aliases.map((a) => [a, v]))
);
export const verb = ALIAS_TO_VERB[first] || 'apply';

export const installSource = verb === 'install' ? positional[1] : null;
export const specArgs = verb === 'spec' ? positional.slice(1) : [];
const specLastArg = specArgs.at(-1);
export const specProjectArg = specArgs.length > 1 && specLastArg && (existsSync(resolve(cleanPath(specLastArg))) || looksLikePath(specLastArg)) ? specLastArg : null;
// `debate` no lleva ruta: sus posicionales son la IDEA, y resolverlos como proyecto convertiría
// las primeras palabras de la idea en una carpeta inexistente.
export const projectArg = verb === 'debate' ? null : verb === 'install' ? positional[2] : verb === 'inspect' ? positional[1] : verb === 'doctor' ? positional[1] : verb === 'spec' ? specProjectArg : (verb === 'qa' || verb === 'deliver' || verb === 'tokens') ? positional[1] : positional[0];
export const projectPath = resolve(projectArg || process.cwd());
export const dryRun = !!flags['dry-run'];
export const assumeYes = !!flags.yes || !!flags.y;
export const force = !!flags.force;
export const allowExternalExec = !!flags['allow-exec'];
export const methodFlags = flags.method ? [].concat(flags.method).map(String) : [];
export const interactive = !!stdin.isTTY && !assumeYes;

// ---------- estilo ----------
export const c = {
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`
};
