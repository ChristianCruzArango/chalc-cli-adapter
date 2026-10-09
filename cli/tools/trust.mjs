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

// `./node`, `C:\tools\node.exe` o `NPM.CMD` son el mismo binario para el sistema: se comparan por
// el nombre base, sin extensión ejecutable y en minúsculas.
const binaryName = (token) => token.split(/[\\/]/).pop().toLowerCase().replace(/\.(exe|cmd|bat|com)$/, '');

// Allowlist POSITIVA de /auto (V-06): comando base + primer argumento posicional que se aprueban sin
// preguntar porque leen o compilan. Una lista negativa de "ejecutores" siempre se queda corta (`go run`,
// `npm test`, `pytest` cargando conftest.py…): aquí, lo que no está, pregunta —intérpretes (`node x.js`),
// runners (`npx`, `npm run`), git que dispara hooks (`commit`, `merge`…)—. `null` = cualquier uso.
// Sustituye al antiguo clasificador negativo `isEvalCapableCommand`, retirado en R35 (spec 016).
const PKG_READ = new Set(['ls', 'list', 'view', 'outdated', 'audit']);
const AUTO_APPROVABLE = new Map([
  ['ls', null], ['cat', null], ['dir', null], ['type', null], ['echo', null], ['mkdir', null],
  ['git', new Set(['status', 'log', 'diff', 'show', 'add', 'rev-parse', 'ls-files', 'blame', 'grep', 'branch', 'describe', 'shortlog'])],
  ['ng', new Set(['build', 'generate', 'g'])],
  ['dotnet', new Set(['build', 'new'])],
  ['flutter', new Set(['analyze', 'build', 'create'])],
  ['dart', new Set(['analyze', 'format'])],
  ['go', new Set(['build', 'vet', 'fmt'])],
  ['cargo', new Set(['build', 'check', 'fmt'])],
  ['npm', PKG_READ], ['pnpm', PKG_READ], ['yarn', PKG_READ]
]);

// Sobre los MISMOS tokens que ejecuta la shell. Lo que no se puede parsear no es auto-aprobable.
function isAutoApprovable(command) {
  let tokens;
  try { tokens = commandTokens(String(command).trim()); } catch { return false; }
  const base = binaryName(tokens[0] || '');
  if (!AUTO_APPROVABLE.has(base)) return false;
  const subs = AUTO_APPROVABLE.get(base);
  const sub = tokens.slice(1).find((tk) => !tk.startsWith('-'));
  return subs === null || subs.has(sub);
}

// Archivos que OTRA herramienta ejecuta sola (V-06): hooks y settings de Claude, el portón y su
// config (`test.command` corre con shell), tareas de VS Code, workflows de CI, scripts de npm, make y
// los conftest.py que pytest importa. Por segmento y sin distinguir mayúsculas (macOS/Windows). La
// ruta NO se normaliza: `.claude/../x` sigue pidiendo confirmación, y ese es el lado seguro.
const SELF_EXECUTING = [
  /(^|\/)\.(claude|vscode)(\/|$)/i,
  /(^|\/)\.chalc\/gate(\.json$|\/)/i,
  /(^|\/)\.github\/workflows\//i,
  /(^|\/)(package\.json|makefile|conftest\.py)$/i
];
const isSelfExecuting = (path) => typeof path === 'string' && SELF_EXECUTING.some((re) => re.test(path.replace(/\\/g, '/')));

// Decisión que consume el approve() de la shell: ¿esta acción exige confirmación humana aunque
// /auto (o "a"=aprobar todo) esté activo? bash fuera de la allowlist positiva, y write/edit sobre
// archivos autoejecutables por la ruta pedida o por la real (`realPath`, que pone cli/tools/fs.mjs).
// Las tools MCP las gobierna cli/mcp/approval.mjs.
export function requiresExplicitApproval(action = {}) {
  const args = action.args || {};
  if (action.tool === 'bash') return !!String(args.command ?? '').trim() && !isAutoApprovable(args.command);
  if (action.tool === 'write' || action.tool === 'edit') return [args.path, args.realPath].some(isSelfExecuting);
  return false;
}

export function resolveShellPolicy(cli = {}) {
  const profile = normalizeTrustProfile(cli.trust || cli.trustProfile || cli.shellProfile || 'dev');
  const customAllow = Array.isArray(cli.allow) ? cli.allow.map(String).filter(Boolean) : null;
  return {
    profile: customAllow ? `${profile}+custom` : profile,
    allow: customAllow || PROFILES[profile] || DEV_ALLOW
  };
}
