// cli/tools/trust.mjs — perfiles de confianza para la herramienta bash del agente.
// La política decide qué comandos base puede intentar el modelo; los guardrails de shell.mjs
// siguen aplicando siempre (sin metacaracteres, sin eval inline, sin rutas fuera del proyecto).

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
const EVAL_CAPABLE_BASE = new Set(['node', 'python', 'python3', 'npx', 'ruby', 'php']);
const RUNNER_SUBCOMMANDS = new Map([
  ['npm', new Set(['run', 'exec', 'x'])],
  ['pnpm', new Set(['run', 'exec', 'dlx'])],
  ['yarn', new Set(['run', 'exec', 'dlx'])],
  ['bun', new Set(['run', 'x'])]
]);

export function isEvalCapableCommand(command) {
  const tokens = String(command || '').trim().toLowerCase().split(/\s+/);
  if (EVAL_CAPABLE_BASE.has(tokens[0])) return true;
  const subs = RUNNER_SUBCOMMANDS.get(tokens[0]);
  return !!subs && subs.has(tokens[1] || '');
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
