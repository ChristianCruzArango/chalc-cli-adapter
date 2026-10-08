// cli/tools/trust.mjs — perfiles de confianza para la herramienta bash del agente.
// La política decide qué comandos base puede intentar el modelo; los guardrails de shell.mjs
// siguen aplicando siempre (sin metacaracteres, sin eval inline, sin rutas fuera del proyecto).

import { commandTokens } from './shell.mjs';

export const DEV_ALLOW = ['ls', 'cat', 'dir', 'type', 'git', 'npm', 'npx', 'node', 'pnpm', 'yarn', 'ng', 'dotnet', 'python', 'python3', 'pip', 'pytest', 'go', 'cargo', 'flutter', 'dart', 'mkdir', 'echo'];

export const TRUSTED_ALLOW = [...new Set([
  ...DEV_ALLOW,
  'mvn', 'gradle', 'php', 'composer', 'ruby', 'rails', 'bin/rails', 'bundle', 'make'
])];

const PROFILES = {
  safe: [],
  dev: DEV_ALLOW,
  trusted: TRUSTED_ALLOW
};

export function normalizeTrustProfile(value) {
  const s = String(value || '').trim().toLowerCase();
  if (['safe', 'locked', 'readonly', 'read-only'].includes(s)) return 'safe';
  if (['trusted', 'trust', 'full'].includes(s)) return 'trusted';
  if (['', 'dev', 'default'].includes(s)) return 'dev';   // sin valor o explícito → dev
  return 'safe';   // valor NO reconocido (typo tipo 'saef') → fail-safe: allowlist vacía, no privilegios
}

// Comandos que EJECUTAN código arbitrario aunque no lleven flags de eval inline: intérpretes
// (node x.js corre lo que diga el script) y runners de paquetes (npx/dlx descargan y ejecutan
// código REMOTO; run/exec corren scripts arbitrarios). Con /auto activo desaparece la aprobación
// humana — la defensa real (5) de shell.mjs — así que estos comandos la piden SIEMPRE.
// Frontera deliberada: compilar/instalar/correr los tests del propio proyecto (npm test, dotnet
// build, cargo build…) queda fuera — es el flujo central del agente y el usuario activó /auto
// sabiendo que el agente trabaja sobre su proyecto. Esto NO es un sandbox: cierra los caminos
// más directos a ejecución arbitraria no supervisada.
const EVAL_CAPABLE_BASE = new Set(['node', 'python', 'python3', 'npx', 'pnpx', 'bunx', 'ruby', 'php']);
// `init`/`create` también: descargan un paquete `create-*` y ejecutan su código.
const NPM_RUNNERS = ['run', 'run-script', 'rum', 'urn', 'exec', 'x', 'init', 'create'];
const RUNNER_SUBCOMMANDS = new Map([
  ['npm', new Set(NPM_RUNNERS)],
  ['pnpm', new Set(['run', 'run-script', 'exec', 'dlx', 'x', 'create', 'init'])],
  ['yarn', new Set(['run', 'exec', 'dlx', 'create', 'init'])],
  ['bun', new Set(['run', 'x', 'create', 'init'])]
]);

// `./node`, `C:\tools\node.exe` o `NPM.CMD` son el mismo binario para el sistema: se comparan por
// el nombre base, sin extensión ejecutable y en minúsculas.
const binaryName = (token) => token.split(/[\\/]/).pop().toLowerCase().replace(/\.(exe|cmd|bat|com)$/, '');

// Clasifica sobre los MISMOS tokens que ejecuta la shell (`commandTokens`): si aprobación y ejecución
// leyeran el texto de forma distinta, `"node" x.js` o `npm "run" x` pasarían por inocuos y luego
// correrían. El subcomando de un runner no está en una posición fija —`npm -s run x`,
// `npm --prefix . run x`—, así que basta con que CUALQUIER token que no sea una opción sea un
// subcomando ejecutor: confundir el valor de una opción con un subcomando solo pide una confirmación
// de más, y ese es el lado seguro. Lo que no se puede parsear también la pide.
// Subcomandos de git que ejecutan un comando arbitrario que viene en sus argumentos.
const GIT_EXEC = [['submodule', 'foreach'], ['bisect', 'run'], ['rebase', '--exec'], ['rebase', '-x'], ['filter-branch'], ['difftool', '--extcmd'], ['mergetool']];

const gitExecutes = (args) => GIT_EXEC.some(([sub, arg]) =>
  args.includes(sub) && (!arg || args.some((tk) => tk === arg || tk.startsWith(`${arg}=`))));

export function isEvalCapableCommand(command) {
  let tokens;
  try { tokens = commandTokens(String(command || '').trim()); } catch { return true; }
  if (!tokens.length) return false;
  const base = binaryName(tokens[0]);
  if (EVAL_CAPABLE_BASE.has(base)) return true;
  if (base === 'git') return gitExecutes(tokens.slice(1));
  const subs = RUNNER_SUBCOMMANDS.get(base);
  return !!subs && tokens.slice(1).some((tk) => !tk.startsWith('-') && subs.has(tk.toLowerCase()));
}

// Decisión que consume el approve() de la shell: ¿esta acción exige confirmación humana aunque
// /auto (o "a"=aprobar todo) esté activo? Solo bash eval-capable; write/edit siguen bajo /auto
// (su contenido es visible y reversible) y las tools MCP las gobierna cli/mcp/approval.mjs.
export function requiresExplicitApproval(action = {}) {
  if (action.tool !== 'bash') return false;
  return isEvalCapableCommand(action.args?.command);
}

export function resolveShellPolicy(cli = {}) {
  const profile = normalizeTrustProfile(cli.trust || cli.trustProfile || cli.shellProfile || 'dev');
  const customAllow = Array.isArray(cli.allow) ? cli.allow.map(String).filter(Boolean) : null;
  return {
    profile: customAllow ? `${profile}+custom` : profile,
    allow: customAllow || PROFILES[profile] || DEV_ALLOW
  };
}
