// cli/tools/gitexec.mjs — opciones y subcomandos de git que EJECUTAN un programa nombrado en la propia
// línea (spec 022, R1). Un `git grep -Osh x` parece una búsqueda y abre los archivos con `sh`. Se vetan
// en la política de la shell (capa 2), con /auto o sin él: el agente no tiene motivo para usarlos.

import { gitSubcommand } from '../../catalog/gate/lib/shellwords.mjs';

// Opciones largas que nombran un ejecutable o config ejecutable. git acepta abreviaturas (`--open`),
// así que se comparan por prefijo, como las de escritura de shellpolicy.mjs.
const EXEC_LONG = ['--open-files-in-pager', '--exec', '--extcmd', '--upload-pack', '--receive-pack', '--config'];

// Letras cortas que ejecutan, por subcomando. `O` (pager de `grep -O`) se veta en cualquier subcomando:
// en los demás es un archivo de orden de diff y su pérdida no le cuesta nada al agente.
const EXEC_SHORT = new Map([['rebase', 'x'], ['difftool', 'x'], ['clone', 'u']]);

// Subcomandos que corren un comando arbitrario: `bisect run <cmd>`, `submodule foreach <cmd>`, `filter-branch`.
const EXEC_SUBCOMMANDS = new Map([['bisect', 'run'], ['submodule', 'foreach'], ['filter-branch', null]]);

const isShortCluster = (tk) => /^-[^-]/.test(tk);
const longName = (tk) => tk.split('=')[0];

function execLong(tk) {
  const name = longName(tk);
  return tk.startsWith('--') && name.length > 2 && EXEC_LONG.some((opt) => opt.startsWith(name));
}

function execShort(tk, sub) {
  if (!isShortCluster(tk)) return false;
  // Stryker disable next-line MethodExpression: equivalente — el guion inicial no es ninguna letra que se busca
  const letters = tk.slice(1);
  return letters.includes('O') || (EXEC_SHORT.has(sub) && letters.includes(EXEC_SHORT.get(sub)));
}

function execSubcommand({ name, rest }) {
  if (!EXEC_SUBCOMMANDS.has(name)) return false;
  const action = EXEC_SUBCOMMANDS.get(name);
  return action === null || rest.find((tk) => !tk.startsWith('-')) === action;
}

// El primer token que hace ejecutar algo a git, o null. `args`: los tokens tras `git`.
export function gitExecOption(args) {
  const sub = gitSubcommand(args);
  if (execSubcommand(sub)) return `${sub.name}${EXEC_SUBCOMMANDS.get(sub.name) ? ' ' + EXEC_SUBCOMMANDS.get(sub.name) : ''}`;
  return args.find((tk) => execLong(tk) || execShort(tk, sub.name)) ?? null;
}
