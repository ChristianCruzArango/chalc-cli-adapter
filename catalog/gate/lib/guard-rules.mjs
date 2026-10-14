// guard-rules.mjs — las reglas de la guarda del asistente (spec 017, R1–R4). Responsabilidad ÚNICA:
// dado el evento `PreToolUse` de un asistente, decidir si la acción pasa, se pregunta o se bloquea.
// Razón de cambio: qué acciones se consideran peligrosas. Puro: no lee el disco ni ejecuta nada.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// Tres clases de regla, cada una devuelve un veredicto o null:
//   - de comando: miran UN comando simple de Bash, ya separado de su cadena (`a && b`);
//   - de herramienta: miran el evento de una herramienta que no es Bash (Read, Grep…);
//   - de cadena: el borrado (`guard-delete.mjs`), que necesita seguir los `cd` de toda la cadena.
// El evento recibe el más severo de todos: un `git push --force` detrás de un `git commit` no se rebaja
// a pregunta por ir segundo. Con la misma severidad manda el primero encontrado.
//
// Devuelve `{ decision, rule, data }`: `rule` es un id de `RULES` que `i18n.mjs` convierte en frase, y
// `data` lo que esa frase necesita. Aquí no hay idioma.

import { gitSubcommand, programOf, shellJoin, simpleCommands } from './shellwords.mjs';
import { isEnvTemplate, isSecretFile } from './secret-files.mjs';
import { deleteRule } from './guard-delete.mjs';
import { RULES } from './rules.mjs';

const ALLOW = Object.freeze({ decision: 'allow', rule: '', data: {} });
const SEVERITY = { allow: 0, ask: 1, deny: 2 };

// Un push forzado reescribe historia que otros ya tienen. `--force-with-lease` y `--force-if-includes`
// son más prudentes, pero siguen sobrescribiendo: también los decide el usuario fuera del asistente.
const FORCE_OPTION = /^--force(?:-with-lease|-if-includes)?(?:=|$)/;
// `-f` también dentro de un grupo de opciones cortas (`-uf`, `-fu`). Lo que sigue a `-o` es su VALOR
// pegado (`-ofix` es la opción de push `fix`), así que una `f` después de una `o` no cuenta.
const FORCE_SHORT = /^-[a-np-zA-Z]*f/;
// Un refspec con `+` delante (`+main`, `+HEAD:main`) fuerza esa rama aunque no haya opción.
const FORCE_REFSPEC = /^\+/;

const forced = (args) => args.some((arg) => FORCE_OPTION.test(arg) || FORCE_SHORT.test(arg) || FORCE_REFSPEC.test(arg));

// R1, R2: commit y push piden la orden del usuario; un push forzado no se hace desde el asistente.
function gitRule(words) {
  const [program, ...args] = programOf(words);
  if (program !== 'git') return null;
  const { name, rest } = gitSubcommand(args);
  const command = shellJoin(words);
  if (name === 'push') return forced(rest) ? { decision: 'deny', rule: RULES.guardGitPushForce, data: { command } } : { decision: 'ask', rule: RULES.guardGitPush, data: { command } };
  if (name === 'commit') return { decision: 'ask', rule: RULES.guardGitCommit, data: { command } };
  return null;
}

// R3: el contenido de un archivo de credenciales no entra al contexto del asistente. Las plantillas sin
// valores (`.env.example`…) sí: dicen qué variables hacen falta sin exponer ninguna.
const secret = (path) => isSecretFile(path) && !isEnvTemplate(path);

// Las lecturas posibles de UNA palabra de shell: la palabra, el valor de `--opcion=ruta` y, con un
// comodín simple, el nombre sin él (`.env*` → `.env`). `*.pem` no necesita nada: el `*` ya ocupa el
// nombre. No expande nada: es una lectura prudente de lo que el comodín podría abarcar.
function readingsOf(word) {
  const value = word.slice(word.indexOf('=') + 1);
  return [word, value].flatMap((w) => [w, w.replace(/[*?]/g, '')]);
}

const secretReadOf = (path) => ({ decision: 'deny', rule: RULES.guardSecretRead, data: { path } });

function secretArgRule(words) {
  const named = words.find((word) => readingsOf(word).some(secret));
  return named ? secretReadOf(named) : null;
}

// Qué campos de cada herramienta de lectura deciden qué CONTENIDO se lee. El `pattern` de Grep es el
// texto buscado y el de Glob solo lista nombres: ninguno de los dos es una lectura. (El `Grep` de contenido
// sobre una carpeta tiene su propia regla, más abajo.)
const READ_FIELDS = {
  Read: ['file_path'],
  NotebookRead: ['notebook_path'],
  Grep: ['path', 'glob'],
  Glob: ['path']
};

/** Las herramientas que la guarda mira: el `matcher` del hook documentado debe cubrir exactamente estas. */
export const GUARDED_TOOLS = Object.freeze(['Bash', ...Object.keys(READ_FIELDS)]);

function secretToolRule(event) {
  const input = event?.tool_input || {};
  const path = (READ_FIELDS[event?.tool_name] || [])
    .map((field) => input[field])
    .find((value) => typeof value === 'string' && readingsOf(value).some(secret));
  return path ? secretReadOf(path) : null;
}

// S8: un `Grep` que DEVUELVE CONTENIDO sobre una carpeta lee archivos que no nombra, `.env` incluido, y sus
// líneas entran al contexto. Sin leer el disco no se sabe si la ruta es carpeta: se toma por archivo solo lo
// que tiene extensión (`src/app.ts`); lo demás —ninguna ruta, `.`, `src`, `src/`— pregunta. Un `type` o un
// `glob` con algo más que comodines acota a archivos concretos y pasa (un `glob` de secretos ya se bloquea).
const looksLikeFile = (path) => /[^\\/.][^\\/]*\.[^\\/.]+$/.test(path);
const narrowed = ({ glob, type }) => (typeof type === 'string' && type !== '') || (typeof glob === 'string' && /[^*?\\/]/.test(glob));

function folderGrepRule(event) {
  const input = event?.tool_input || {};
  if (event?.tool_name !== 'Grep' || input.output_mode !== 'content' || narrowed(input)) return null;
  const path = typeof input.path === 'string' && input.path ? input.path : '.';
  return looksLikeFile(path) ? null : { decision: 'ask', rule: RULES.guardSecretGrep, data: { path } };
}

const COMMAND_RULES = [gitRule, secretArgRule];
const TOOL_RULES = [secretToolRule, folderGrepRule];

const commandOf = (event) => {
  const command = event?.tool_input?.command;
  return event?.tool_name === 'Bash' && typeof command === 'string' ? command : '';
};

const mostSevere = (a, b) => (SEVERITY[b.decision] > SEVERITY[a.decision] ? b : a);

// Desde dónde se juzga el evento: la raíz del proyecto (la explícita, o la carpeta en la que el
// asistente abrió la shell) y dónde está la shell ahora. Claude Code manda `cwd` en cada evento.
function placeOf(event, { root } = {}) {
  const cwd = typeof event?.cwd === 'string' ? event.cwd : '';
  return { root: root || cwd, cwd: cwd || root || '' };
}

/** El veredicto de la guarda para un evento `PreToolUse`: `{ decision: 'allow'|'ask'|'deny', rule, data }`. */
export function decide(event, options = {}) {
  const commands = simpleCommands(commandOf(event));
  const byTool = TOOL_RULES.map((rule) => rule(event));
  const byCommand = commands.flatMap((words) => COMMAND_RULES.map((rule) => rule(words)));
  const byChain = deleteRule(commands, placeOf(event, options));
  return [...byTool, ...byCommand, byChain].filter(Boolean).reduce(mostSevere, ALLOW);
}
