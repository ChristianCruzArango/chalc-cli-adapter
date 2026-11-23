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

import { gitSubcommand, programOf, shellJoin, shellScript, simpleCommands } from './shellwords.mjs';
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

// Saltarse los hooks (spec 029, R6). En `commit`, `-n` es `--no-verify`, también dentro de un grupo (`-anm`);
// pero lo que sigue a `-m`, `-F`, `-C`, `-c` o `-t` es su VALOR pegado (`-mn` es el mensaje «n»). En `push`,
// `-n` es `--dry-run`: ahí solo cuenta la forma larga.
const NO_VERIFY_SHORT = /^-[^-mFCct=]*n/;
// Opciones de `commit` cuyo VALOR va en el argumento siguiente: ese valor no es una opción (`-m "--no-verify"`
// es un mensaje, no un salto de hooks).
const TAKES_VALUE = /^(?:-[a-zA-Z]*[mFCct]|--(?:message|file|reuse-message|reedit-message|template|author|date|cleanup|fixup|squash))$/;
const withoutValues = (args) => args.filter((_, i) => i === 0 || !TAKES_VALUE.test(args[i - 1]));
const skipsHooks = (name, args) => {
  const options = name === 'commit' ? withoutValues(args) : args;
  return options.includes('--no-verify') || (name === 'commit' && options.some((arg) => NO_VERIFY_SHORT.test(arg)));
};

// R1, R2: commit y push piden la orden del usuario; un push forzado no se hace desde el asistente.
// Traer la rama de integración a otra rama (spec 035, R11): fusionarla ES aprobar el cierre, y eso es del usuario.
const BRINGS_IN = new Set(['merge', 'rebase', 'cherry-pick', 'pull']);
const INTEGRATION_BRANCH = /(?:^|\/)chalc\/int-/;

function gitRule(words) {
  const [program, ...args] = programOf(words);
  if (program !== 'git') return null;
  const { name, rest } = gitSubcommand(args);
  const command = shellJoin(words);
  if (BRINGS_IN.has(name) && rest.some((arg) => INTEGRATION_BRANCH.test(arg))) return { decision: 'deny', rule: RULES.guardIntegrationMerge, data: { command } };
  if (name !== 'push' && name !== 'commit') return null;
  if (name === 'push' && forced(rest)) return { decision: 'deny', rule: RULES.guardGitPushForce, data: { command } };
  if (skipsHooks(name, rest)) return { decision: 'deny', rule: RULES.guardNoVerify, data: { command } };
  return { decision: 'ask', rule: name === 'push' ? RULES.guardGitPush : RULES.guardGitCommit, data: { command } };
}

// Spec 024, R15: aprobar la spec (o, después, la feature) es del usuario y desde SU terminal. Cualquier
// comando que invoque la entrada del portón con una opción `--approve-…` se deniega, lo lance como lo lance
// (`script`, una tubería, `bash -c`): no hay forma de que el asistente lo ejecute con el OK de nadie.
const APPROVE_OPTION = /^--approve-/;
const GATE_ENTRY = /(?:^|[\\/])gate\.mjs$/;

function approveRule(words) {
  if (!words.some((word) => APPROVE_OPTION.test(word)) || !words.some((word) => GATE_ENTRY.test(word))) return null;
  return { decision: 'deny', rule: RULES.guardApprove, data: { command: shellJoin(words) } };
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

const COMMAND_RULES = [gitRule, secretArgRule, approveRule];
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

// R10 (spec 023): `bash -c "git push"` ejecuta el push dentro de una cadena. A cada comando simple se le suman
// los de su script, hasta MAX_SHELL_DEPTH niveles para no recorrer sin fin. Solo para las reglas de comando:
// un `cd` dentro del script no mueve la shell de fuera, así que el borrado sigue leyendo la cadena original.
const MAX_SHELL_DEPTH = 3;

// Sin script, `shellScript` da null y `simpleCommands(null)` ningún comando: no hace falta otra rama.
const withScripts = (commands, depth = 0) => commands.flatMap((words) => (depth < MAX_SHELL_DEPTH
  ? [words, ...withScripts(simpleCommands(shellScript(words)), depth + 1)]
  : [words]));

/** El veredicto de la guarda para un evento `PreToolUse`: `{ decision: 'allow'|'ask'|'deny', rule, data }`. */
export function decide(event, options = {}) {
  const commands = simpleCommands(commandOf(event));
  const byTool = TOOL_RULES.map((rule) => rule(event));
  const byCommand = withScripts(commands).flatMap((words) => COMMAND_RULES.map((rule) => rule(words)));
  const byChain = deleteRule(commands, placeOf(event, options));
  return [...byTool, ...byCommand, byChain].filter(Boolean).reduce(mostSevere, ALLOW);
}
