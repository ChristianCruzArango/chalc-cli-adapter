// test/helpers/mutatescope.mjs — qué muta Stryker (spec 022, R21, 5.5). Responsabilidad ÚNICA: traducir lo que
// cambió desde una base de git a la lista `mutate` de stryker.config.mjs. Razón de cambio: qué cuenta como código
// de la revisión que se mide.
//
// Antes la lista era literal y se congelaba en la revisión que la escribió: el código cambiaba, las líneas ya no
// coincidían y `npm run test:mutation` medía otra cosa que la que se decía. Ahora se calcula como hace el portón,
// con el mismo lector de diffs (catalog/gate/lib/hunks.mjs). Solo desarrollo: no viaja en el paquete.

import { execFileSync } from 'node:child_process';
import { parseHunks, rangesOf } from '../../catalog/gate/lib/hunks.mjs';

const ROOTS = ['bin', 'cli', 'lib', 'targets', 'catalog'];
// Fuera: los diccionarios (tablas de texto) y los entrypoints, que solo se prueban por subproceso.
const ENTRYPOINTS = new Set(['bin/chalc.mjs', 'cli/index.mjs']);
// Las tablas de texto es/en de las herramientas del equipo, el diseño, las sondas y los evals (specs 032–042):
// son diccionarios, como `lib/i18n/`. Su paridad de claves y cada mensaje que se muestra los cubren sus tests;
// mutar cada frase solo se mata copiándola en un test. La lógica de esos árboles SÍ se muta.
const TEXT_TABLES = /^catalog\/(team|design|probe|evals)\/lib\/i18n(-[a-z]+)?\.mjs$/;

// La sonda de diseño (spec 039) son funciones que se envían como TEXTO al navegador: instrumentadas llaman a
// ayudantes de Stryker que en la página no existen, y ni la corrida inicial pasa. La cubren sus tests con un DOM
// simulado y la prueba opcional con navegador real.
const RUNS_IN_PAGE = new Set(['catalog/design/lib/probe.mjs']);

/** ¿Es código que Stryker debe mutar? */
export function isMutable(path) {
  const p = String(path).replace(/\\/g, '/');
  if (!/\.m?js$/.test(p) || ENTRYPOINTS.has(p) || p.startsWith('lib/i18n/') || TEXT_TABLES.test(p) || RUNS_IN_PAGE.has(p)) return false;
  return ROOTS.some((root) => p.startsWith(`${root}/`));
}

/** La lista `mutate`: cada tramo nuevo del diff como `archivo:desde-hasta`, y los archivos nuevos enteros. */
export function mutateScope({ diff = '', untracked = [] } = {}) {
  const out = [];
  for (const [file, lines] of parseHunks(diff)) {
    if (!isMutable(file)) continue;
    for (const [from, to] of rangesOf(lines, { gap: 1 })) out.push(`${file}:${from}-${to}`);
  }
  out.push(...untracked.filter(isMutable));
  const at = (entry) => [entry.replace(/:\d+-\d+$/, ''), Number(/:(\d+)-\d+$/.exec(entry)?.[1] || 0)];
  return out.sort((a, b) => {
    const [fa, la] = at(a);
    const [fb, lb] = at(b);
    return fa === fb ? la - lb : fa.localeCompare(fb);
  });
}

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }).trim();
const tryGit = (cwd, args) => { try { return git(cwd, args); } catch { return ''; } };

/** La base del diff: `CHALC_MUTATE_BASE`; si no, el merge-base con main; si eso es HEAD (o no hay main), HEAD~1. */
export function mutateBase(env = process.env, cwd = process.cwd()) {
  if (env.CHALC_MUTATE_BASE) return env.CHALC_MUTATE_BASE;
  const head = tryGit(cwd, ['rev-parse', 'HEAD']);
  const mergeBase = tryGit(cwd, ['merge-base', 'HEAD', 'main']) || tryGit(cwd, ['merge-base', 'HEAD', 'origin/main']);
  return mergeBase && mergeBase !== head ? mergeBase : 'HEAD~1';
}

/** El alcance del árbol de trabajo de `cwd` frente a `base` (cambios sin commitear incluidos). */
export function gitMutateScope(base, cwd = process.cwd()) {
  // Una base que empieza por `-` sería una opción de git, no un commit.
  if (!base || String(base).startsWith('-')) throw new Error(`invalid mutation base: ${base}`);
  const diff = git(cwd, ['diff', '-U0', '--no-color', '--no-ext-diff', base, '--', ...ROOTS]);
  const untracked = git(cwd, ['ls-files', '--others', '--exclude-standard', '--', ...ROOTS]).split('\n').filter(Boolean);
  return mutateScope({ diff, untracked });
}
