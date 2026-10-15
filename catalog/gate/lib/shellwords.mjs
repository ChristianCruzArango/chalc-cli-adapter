// shellwords.mjs — leer un comando de shell sin ejecutarlo (spec 017, R1–R4). Responsabilidad ÚNICA:
// convertir el texto de un comando en palabras y comandos simples. Razón de cambio: qué parte de la
// gramática de la shell se reconoce. Puro.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// Dos lectores con dos necesidades distintas:
//   - `commandTokens`: la shell propia de chalc (`cli/tools/shellpolicy.mjs`) rechaza encadenados y
//     redirecciones antes de tokenizar, así que solo necesita palabras y comillas. Vivía allí; se movió
//     aquí para que la guarda lea las palabras exactamente igual.
//   - `simpleCommands`: la guarda recibe el comando ENTERO que Claude Code va a lanzar, con `&&`,
//     tuberías y sustituciones. Un `git push` detrás de un `&&` es tan push como uno suelto.
//
// Esto NO es un parser de bash: no expande variables, ni alias, ni `eval`. Sube el listón; un comando
// ofuscado a propósito puede esquivarlo (spec 017, R5).

// Parser intencionalmente pequeño: acepta palabras y comillas simples/dobles, pero NO escapes. Como no
// hay shell después, `\\-c` llega literal al binario, no se convierte en `-c`. Rechazamos comillas sin cerrar.
export function commandTokens(cmd) {
  const out = [];
  let cur = '';
  let quote = '';
  for (const ch of String(cmd)) {
    if (quote) {
      if (ch === quote) quote = '';
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (/\s/.test(ch)) {
      if (cur) { out.push(cur); cur = ''; }
      continue;
    }
    cur += ch;
  }
  if (quote) throw new Error('unterminated quote');
  if (cur) out.push(cur);
  return out;
}

// Opciones globales de git que consumen el token siguiente: el subcomando es lo que viene después.
const GIT_GLOBAL_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env']);

/** El subcomando de git (`push`, `commit`…) y lo que le sigue, saltando las opciones globales. */
export function gitSubcommand(args) {
  for (let i = 0; i < args.length; i++) {
    if (GIT_GLOBAL_WITH_VALUE.has(args[i])) { i++; continue; }
    if (!args[i].startsWith('-')) return { name: args[i], rest: args.slice(i + 1) };
  }
  return { name: '', rest: [] };
}

// Lo que termina un comando simple y empieza otro: encadenados (`;` `&&` `||` `&`), tuberías, saltos de
// línea y los bordes de un subshell (`(` `)`). Las llaves de un grupo, aparte: ver `groupBrace`.
const SEPARATOR = /[;&|\n\r()]/;
// Una redirección (`<`, `>`) corta la palabra, pero su destino sigue siendo parte del comando: `cat<.env`
// lee `.env`.
const WORD_BREAK = /[\s<>]/;
// El `&` de una redirección (`2>&1`, `<&3`, `&>out`) es parte de ella, no manda el comando al fondo.
const redirects = (text, i) => /[<>]/.test(text[i - 1] ?? '') || text[i + 1] === '>';
// Una llave es de grupo (`{ git push; }`) solo con la sintaxis de bash: al empezar una palabra y, la de
// apertura, seguida de un espacio. Dentro de una palabra es parte de ella: `${X}`, `dist/{a,b}`. Leerla
// siempre como separador dejaba `rm -rf {..,x}` sin operando.
const groupBrace = (r, text, i) => !r.cur && (text[i] === '}' || (text[i] === '{' && /\s/.test(text[i + 1] ?? ' ')));

// Lo que queda en el comando de fuera donde había una sustitución. Lleva `$`: para quien lo lea es un
// valor que no se conoce, igual que una variable (`rm -rf $(pwd)/x` → `rm -rf $(…)/x`).
export const SUBSTITUTION = '$(…)';

// El estado del lector. Una sustitución (`$(…)`, `` `…` ``) abre un MARCO: el comando de dentro se lee
// como uno propio y, al cerrarla, el de fuera sigue donde estaba con el marcador en su lugar. Leerla
// como un simple separador partía el comando de fuera y le quitaba el operando.
const reader = () => ({ commands: [], words: [], cur: '', quote: '', escape: false, frames: [] });

const endWord = (r) => { if (r.cur) r.words.push(r.cur); r.cur = ''; };
const endCommand = (r) => { endWord(r); if (r.words.length) r.commands.push(r.words); r.words = []; };

function open(r, closer) {
  r.frames.push({ words: r.words, cur: r.cur.replace(/\$$/, ''), quote: r.quote, closer });
  Object.assign(r, { words: [], cur: '', quote: '' });
}

function close(r) {
  endCommand(r);
  const frame = r.frames.pop();
  Object.assign(r, { words: frame.words, cur: frame.cur + SUBSTITUTION, quote: frame.quote });
}

const closing = (r, closer) => r.frames.at(-1)?.closer === closer;

// Lo que abre o cierra una sustitución, en cualquier contexto en el que la shell la expande (fuera de
// comillas o entre comillas dobles). Devuelve true si el carácter ya quedó leído.
function substitution(r, ch) {
  if (ch === '`') { if (closing(r, '`')) close(r); else open(r, '`'); return true; }
  if (ch === '(' && r.cur.endsWith('$')) { open(r, ')'); return true; }
  if (ch === ')' && closing(r, ')')) { close(r); return true; }
  return false;
}

// Entre comillas dobles, `\` solo escapa estos (POSIX); ante cualquier otro carácter la barra se queda. Sin
// esto, `sh -c "bash -c \"git push\""` se partía y el comando de dentro no se veía (spec 023, R10).
// Al final del texto, `text[i + 1]` no existe y `test(undefined)` da false: la barra se queda.
const DOUBLE_QUOTE_ESCAPABLE = /["\\$`\n]/;

function quoted(r, text, i) {
  const ch = text[i];
  if (ch === r.quote) r.quote = '';
  else if (r.quote === '"' && ch === '\\' && DOUBLE_QUOTE_ESCAPABLE.test(text[i + 1])) r.escape = true;
  else if (r.quote === "'" || !substitution(r, ch)) r.cur += ch;
}

function unquoted(r, text, i) {
  const ch = text[i];
  if (ch === '\\') r.escape = true;
  else if (ch === '"' || ch === "'") r.quote = ch;
  else if (substitution(r, ch)) return;
  else if (ch === '&' && redirects(text, i)) endWord(r);
  else if (SEPARATOR.test(ch) || groupBrace(r, text, i)) endCommand(r);
  else if (WORD_BREAK.test(ch)) endWord(r);
  else r.cur += ch;
}

/** Los comandos simples de una línea de shell, cada uno como lista de palabras. Nunca lanza. */
export function simpleCommands(cmd) {
  const r = reader();
  const text = String(cmd ?? '');
  for (let i = 0; i < text.length; i++) {
    // `${NAME}` es UNA palabra: sus llaves no son las de un grupo `{ …; }`.
    // Tras `\` fuera de comillas (o dentro de dobles, ver `quoted`), el carácter es literal:
    // `find . \( -name a \)` no abre un subshell.
    if (r.escape) { r.cur += text[i]; r.escape = false; }
    else if (r.quote) quoted(r, text, i);
    else unquoted(r, text, i);
  }
  // Una comilla o una sustitución sin cerrar no se rechaza: aquí no se ejecuta nada, y lo leído hasta el
  // final es la mejor lectura posible de lo que se intentó.
  while (r.frames.length) close(r);
  endCommand(r);
  return r.commands;
}

// Lo que una palabra puede llevar sin comillas y leerse igual en la shell.
const PLAIN_WORD = /^[\w\-./=:,@%+^~]+$/;
const quote = (word) => (PLAIN_WORD.test(word) || word.includes(SUBSTITUTION) ? word : `'${word.replaceAll("'", "'\\''")}'`);

/** Las palabras de un comando unidas como se escribirían (spec 018, R11): comillas solo donde hacen falta. */
export const shellJoin = (words) => words.map(quote).join(' ');

// Lo que va delante del programa real sin cambiar cuál es: asignaciones (`GIT_TRACE=1 git push`) y
// envoltorios que ejecutan el resto (`sudo`, `env`…). De los envoltorios se saltan también sus opciones.
// Límite: el VALOR de una opción del envoltorio (`sudo -u root git`, `nice -n 10 git`) se lee como el
// programa. Cubrirlo exigiría la tabla de opciones de cada envoltorio.
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const WRAPPERS = new Set(['sudo', 'env', 'command', 'nohup', 'time', 'exec', 'nice']);
const baseName = (word) => word.split(/[\\/]/).pop().replace(/\.exe$/i, '');

/** Las palabras de un comando simple desde su programa real, con el programa sin ruta (`git`, no `/usr/bin/git`). */
export function programOf(words) {
  let i = 0;
  let wrapped = false;
  while (i < words.length) {
    const word = words[i];
    if (ASSIGNMENT.test(word) || (wrapped && word.startsWith('-'))) { i++; continue; }
    if (WRAPPERS.has(baseName(word))) { wrapped = true; i++; continue; }
    break;
  }
  return i < words.length ? [baseName(words[i]), ...words.slice(i + 1)] : [];
}

// Una shell lanzada con `-c` ejecuta la cadena que sigue a sus opciones (spec 023, R10): `bash -c "git push"`
// es un push aunque el programa sea `bash`. La `c` cuenta también agrupada (`-lc`). `-o`/`-O` consumen su
// valor: en `bash -o c x.sh` la `c` es una opción de `set`, no un script.
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash']);
const SHELL_OPTION_WITH_VALUE = new Set(['-o', '+o', '-O', '+O']);
const COMMAND_OPTION = /^-[a-zA-Z]*c[a-zA-Z]*$/;

/** La cadena que ejecuta una shell lanzada con `-c` (`bash -c "git push"` → `git push`), o null. */
export function shellScript(words) {
  const [program, ...args] = programOf(words);
  if (!SHELLS.has(program)) return null;
  let command = false;
  for (let i = 0; i < args.length; i++) {
    if (SHELL_OPTION_WITH_VALUE.has(args[i])) { i++; continue; }
    if (!/^[-+]/.test(args[i])) return command ? args[i] : null;
    command ||= COMMAND_OPTION.test(args[i]);
  }
  return null;
}
