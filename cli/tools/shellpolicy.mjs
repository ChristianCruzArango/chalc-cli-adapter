// cli/tools/shellpolicy.mjs — capas 1-4 de la herramienta de shell (ver cli/tools/shell.mjs): qué
// comandos se aceptan antes de pedir la aprobación humana. Pura salvo `landsOutsideRoot` y `inGitDir`,
// que miran el disco para distinguir un dato de un archivo ajeno o de `.git/`.

import { realpathSync } from 'node:fs';
import { relative, resolve, parse } from 'node:path';
import { deepestExistingRealpath, escapes, GIT_DIR } from './fsconfine.mjs';
// Las palabras y el subcomando de git se leen igual que en la guarda del asistente (spec 017): viven en
// el portón, que se emite al repo equipado.
import { commandTokens, gitSubcommand } from '../../catalog/gate/lib/shellwords.mjs';
import { gitExecOption } from './gitexec.mjs';

const FORBIDDEN = /[;&|`$><\n\r]/;   // encadenado, redirección y sustitución: prohibidos
// Caracteres de control (ESC incluido): un `\x1b[2K` en el comando haría que el aviso de aprobación
// mostrase algo distinto de lo que se va a ejecutar.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/;

// Flags que evalúan código inline u hoyos equivalentes, por comando base. El agente tiene alternativa
// legítima y VISIBLE: escribir un script con write (pasa por aprobación con su contenido) y ejecutarlo.
const INLINE_EVAL = new Map([
  ['node', new Set(['-e', '--eval', '-p', '--print', '--require', '-r', '--import', '--loader', '--experimental-loader'])],
  ['python', new Set(['-c'])],
  ['python3', new Set(['-c'])],
  ['git', new Set(['-c', '--config-env'])]   // git -c inyecta config ejecutable (core.fsmonitor=<cmd>, etc.)
]);

// Letras de flag corto que llevan un valor pegado: a partir de ellas el resto del token es dato
// (`python -Wignore`), no más flags. Sin esto `-Wdefault` contendría una `c` "prohibida".
const SHORT_VALUE_FLAGS = new Map([
  ['node', new Set(['C'])],
  ['python', new Set(['m', 'W', 'X', 'Q'])],
  ['python3', new Set(['m', 'W', 'X', 'Q'])],
  ['git', new Set(['C'])]
]);

// El flag de evaluación que lleva un token, o null. La comparación exacta dejaba pasar las formas
// que los binarios aceptan igual: `--require=./x.js`, `-r./x.js`, `-pe` (= `-p -e`) o `python -Bc`.
function inlineEvalFlag(base, token) {
  const banned = INLINE_EVAL.get(base);
  if (!banned || !token.startsWith('-')) return null;
  if (token.startsWith('--')) {
    const name = token.split('=')[0];
    return banned.has(name) ? name : null;
  }
  const valueFlags = SHORT_VALUE_FLAGS.get(base) || new Set();
  for (const letter of token.slice(1)) {
    if (banned.has(`-${letter}`)) return `-${letter}`;
    if (valueFlags.has(letter)) return null;
  }
  return null;
}

const GIT_CONFIG_READS = new Set(['--get', '--get-all', '--get-regexp', '--get-urlmatch', '--list', '-l', '--show-origin', '--show-scope', '--name-only']);

// `git config` que ESCRIBE deja ejecución diferida que sobrevive a la sesión: `core.fsmonitor`,
// `core.hooksPath`, `alias.x=!cmd`… se disparan en el siguiente `git status`. Leer la config es
// inocuo; cambiarla es trabajo del humano. Los subcomandos `config get/list` de git ≥2.46 también leen.
function gitConfigWrite(args) {
  const { name, rest } = gitSubcommand(args);
  if (name !== 'config') return false;
  if (rest.some((tk) => GIT_CONFIG_READS.has(tk.split('=')[0]))) return false;
  if (['get', 'list'].includes(rest.find((tk) => !tk.startsWith('-')))) return false;
  return true;
}

export function pathValue(token) {
  const t = String(token || '').trim();
  if (!t || t === '--') return '';
  const eq = t.indexOf('=');
  return eq > 0 ? t.slice(eq + 1) : t;
}

// Rutas que ESCAPAN del proyecto por traversal (..) o home (~): peligrosas siempre, sean argumento
// posicional o valor de una opción (`npm --prefix=..` escapa igual). Cubre también `~usuario/` (home de
// OTRO usuario); el nombre debe empezar por letra/_ para no confundir semver (`~1.2.3`) con una ruta.
function escapesProjectRoot(token) {
  const value = pathValue(token);
  if (!value) return false;
  if (/^~(?:[A-Za-z_][\w.-]*)?(?:[/\\]|$)/.test(value)) return true;
  return value.replace(/\\/g, '/').split('/').includes('..');
}

// Ruta ABSOLUTA (/etc, C:\...). Solo sospechosa como argumento POSICIONAL (`cat /etc/passwd`); como valor
// de una opción suele ser dato, no un archivo (`ng build --base-href /app/`), y ahí manda la aprobación (5).
function isAbsolutePath(token) {
  const value = pathValue(token);
  return !!value && /^(?:[a-zA-Z]:[\\/]|[/\\]{1,2})/.test(value);
}

// Un argumento que cae FUERA del proyecto, exista o no (V-05): posicional, valor de una opción
// (`--output=/tmp/nuevo/x`) o un enlace interno que apunta fuera. Se mira el ancestro EXISTENTE más
// profundo, como resolveInRoot: una ruta nueva bajo una carpeta ajena (`/tmp/nuevo-dir/x`) escapa igual.
// Lo que separa un dato de un archivo: si de un valor absoluto solo existe la raíz del sistema de
// archivos (`--base-href /app/`), no nombra ningún lugar real y se trata como dato. Una URL nunca
// cae fuera: resuelta como ruta queda dentro de la raíz (igual que un valor vacío, que es la raíz).
function landsOutsideRoot(root, token) {
  const real = deepestExistingRealpath(resolve(root, pathValue(token)));
  if (real === null) return true;   // enlace colgante o en bucle: su destino puede estar fuera
  return real !== parse(real).root && escapes(realpathSync(root), real);
}

// Un argumento que apunta dentro de `.git/` (V-05): por lo escrito (`.git/config`, `x/../.git`) o por
// la ruta real (un enlace interno hacia `.git`). Un `.git/config` con core.fsmonitor o un hook se
// ejecutan solos en el siguiente `git status` o commit.
function inGitDir(root, token) {
  const value = pathValue(token);
  if (GIT_DIR.test(value)) return true;
  const real = deepestExistingRealpath(resolve(root, value));
  return !!real && GIT_DIR.test(relative(realpathSync(root), real));
}

// Opciones de git que escriben archivos donde digan (`--output`, `--output-directory`, `-o` de
// format-patch) o cambian lo que git ejecuta (`--template` copia hooks, `--exec-path`). git acepta
// abreviaturas de opciones largas (`--outp`), así que se compara por prefijo (sin contar `--`, fin de opciones).
const GIT_WRITE_OPTIONS = ['--output', '--output-directory', '--template'];
function gitUnsafeOption(args) {
  return args.find((tk) => {
    const name = tk.split('=')[0];
    if (name === '--exec-path') return true;
    if (name === '-o') return args.includes('format-patch');
    return name.length > 2 && GIT_WRITE_OPTIONS.some((opt) => opt.startsWith(name));
  });
}

// El primer argumento con una ruta que escapa del proyecto: traversal/home siempre; absoluta solo si
// es posicional (ver la nota en checkCommand).
function unsafePathArg(args) {
  let afterEndOfOptions = false;
  return args.find((tk, i) => {
    if (tk === '--') { afterEndOfOptions = true; return false; }
    if (escapesProjectRoot(tk)) return true;
    if (afterEndOfOptions) return isAbsolutePath(tk);
    const prev = i > 0 ? args[i - 1] : '';
    const optionLike = /^-/.test(tk) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(tk) || /^\/[A-Za-z][A-Za-z0-9]*:/.test(tk);
    const longOptionValue = /^--./.test(prev) && !prev.includes('=');
    return !optionLike && !longOptionValue && isAbsolutePath(tk);
  });
}

// Las asignaciones (`make PREFIX=/usr/local`) y los switches MSBuild (`/t:Build`) son datos de la
// herramienta, no lecturas: quedan fuera de la comprobación de rutas reales.
const isData = (tk) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(tk) || /^\/[A-Za-z][A-Za-z0-9]*:/.test(tk);

// Guardas sobre el texto crudo, antes de tokenizar: `[predicado, mensaje, mostrar?]`.
const TEXT_GUARDS = [
  [(cmd) => FORBIDDEN.test(cmd), () => 'shell metacharacters not allowed (; & | ` $ > <); one single command per action'],
  [(cmd) => CONTROL_CHARS.test(cmd), () => 'control characters are not allowed in commands', JSON.stringify]
];

// Guardas sobre los tokens (capas 2-4): `[hallar(ctx) → lo ofensivo | falsy, mensaje(lo ofensivo, ctx)]`.
// La primera que encuentra algo rechaza el comando. Notas de las rutas:
// - Traversal/home (.. ~) se bloquea SIEMPRE (posicional o valor de opción: `npm --prefix=..` escapa).
// - La ruta ABSOLUTA solo si es POSICIONAL: como valor de una opción larga (`--base-href /app/`),
//   asignación (`make PREFIX=/usr/local`) o switch MSBuild (`/t:Build`) es dato, no un archivo —
//   bloquearlo daba falsos positivos en builds legítimos. Ahí manda la aprobación (5). Solo las opciones
//   LARGAS (--foo) blindan al token siguiente: un flag corto (-v) suele ser booleano, y tras `--` (fin
//   de opciones POSIX) todo es posicional por definición.
const TOKEN_GUARDS = [
  [({ base, allow }) => !allow.includes(base), (_, { base, allow }) => `command not allowed: ${base}. Allowed: ${allow.join(', ') || '(none)'}`],
  [({ base, args }) => args.map((tk) => inlineEvalFlag(base, tk)).find(Boolean), (flag, { base }) => `flag not allowed for ${base}: ${flag}. Write a script file with write and run it.`],
  [({ base, args }) => base === 'git' && gitConfigWrite(args), () => 'git config writes are not allowed: they can run commands later (core.fsmonitor, core.hooksPath, alias.x=!cmd). Reading with --get/--list is fine; ask the user to change git config.'],
  [({ base, args }) => base === 'git' && gitExecOption(args), (opt) => `git option not allowed: ${opt}. It makes git run a program; run commands only through this tool, one at a time.`],
  [({ base, args }) => base === 'git' && gitUnsafeOption(args), (opt) => `git option not allowed: ${opt}. It writes files or changes what git runs; use write for files.`],
  [({ args }) => unsafePathArg(args), (tk) => `path argument outside the project is not allowed: ${tk}`],
  [({ root, args }) => args.find((tk) => !isData(tk) && landsOutsideRoot(root, tk)), (tk) => `path argument outside the project is not allowed: ${tk}`],
  [({ root, args }) => args.find((tk) => inGitDir(root, tk)), (tk) => `paths inside .git/ are not allowed: ${tk}`]
];

// Las capas 1-4 sobre un comando: devuelve `{ error, command? }` si se rechaza, o `{ tokens, args }`.
export function checkCommand(cmd, { root, allow }) {
  if (!cmd) return { error: 'empty command' };
  for (const [rejects, message, show = (c) => c] of TEXT_GUARDS) {
    if (rejects(cmd)) return { command: show(cmd), error: message() };
  }
  let tokens;
  try { tokens = commandTokens(cmd); }
  catch { return { command: cmd, error: 'unterminated quote' }; }
  const ctx = { root, allow, base: tokens[0], args: tokens.slice(1) };
  for (const [find, message] of TOKEN_GUARDS) {
    const found = find(ctx);
    if (found) return { command: cmd, error: message(found, ctx) };
  }
  return { tokens, args: ctx.args };
}
