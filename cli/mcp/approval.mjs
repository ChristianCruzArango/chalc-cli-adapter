// Política explícita para aprobar acciones MCP y locales.
// Principio base: DEFAULT-DENY. Ante lo desconocido —una tool local no catalogada, un modo mal escrito—
// se pide aprobación / se cae al lado MÁS estricto, nunca al permisivo. Así una tool nueva o un typo no
// concede ejecución por omisión.

// Un nombre es de solo-lectura si EMPIEZA por un verbo de lectura como segmento completo (seguido de _/-/fin),
// no como mero prefijo: 'getter'/'documentDelete'/'docker' NO cuentan.
import { isAbsolute, relative, resolve } from 'node:path';

export const MCP_READONLY = /^(get|list|read|search|find|show|describe|status|inspect|fetch|query|count|view)([_-]|$)/i;
// …salvo que el nombre delate MUTACIÓN aunque empiece por un verbo de lectura (get_or_create, search_and_purge).
const MCP_MUTATING_HINT = /(create|update|delete|remove|write|set|put|patch|post|send|add|insert|purge|drop|edit|modify|rename|move|upload|execute|run|approve|revoke|cancel|close|merge|reset|clear|disable|enable)/i;

// Un nombre declarado por un servidor no prueba que la operación sea inocua. Por eso el valor seguro
// por defecto exige aprobación de TODA llamada MCP; `mutating` queda como opt-in para servidores conocidos.
export function normalizeMcpApprovalMode(value, fallback = 'always') {
  const s = String(value || '').trim().toLowerCase();
  if (['mutating', 'mutation', 'write', 'writes', 'read-only', 'readonly', 'smart', 'default'].includes(s)) return 'mutating';
  if (['always', 'all', 'strict', 'explicit', 'per-action', 'cada-accion', 'cada acción'].includes(s)) return 'always';
  if (!s) return fallback;          // sin valor → el default configurado
  return 'always';                  // valor NO reconocido (typo) → fail-safe: el modo más estricto
}

// El nombre de la tool es TODO lo que va detrás de `mcp__<servidor>__`. Con `split('__').pop()` una
// tool llamada `drop_db__list` se leía como `list` y pasaba por solo lectura.
export function isReadOnlyMcpTool(tool) {
  const m = /^mcp__[^_]+(?:_[^_]+)*?__(.+)$/.exec(String(tool || ''));
  if (!m) return false;
  const name = m[1];
  return MCP_READONLY.test(name) && !MCP_MUTATING_HINT.test(name);
}

export function createApprovalPolicy({ mcpMode = 'always', mutatingTools = ['write', 'edit', 'bash'], readOnlyTools = ['read', 'list', 'grep'] } = {}) {
  const mode = normalizeMcpApprovalMode(mcpMode);
  const mutating = new Set(mutatingTools);
  const readOnly = new Set(readOnlyTools);
  return {
    mcpMode: mode,
    needsApproval(tool) {
      const name = String(tool || '');
      if (mutating.has(name)) return true;
      if (name.startsWith('mcp__')) {
        if (mode === 'always') return true;
        return !isReadOnlyMcpTool(name);
      }
      // Herramienta LOCAL: aprobar salvo que sea de solo-lectura CONOCIDA. Default-deny para tools
      // nuevas/mutantes (move, rm, apply_patch…) que no estén en el set de lectura.
      return !readOnly.has(name);
    }
  };
}

// ── aprobación de servidores ──────────────────────────────────────────────────────────────────
// El `.mcp.json` viene del repositorio. Aprobar solo `command + args` dejaba fuera lo que de verdad
// decide qué se ejecuta: `"env": {"NODE_OPTIONS": "--require ./.x.js"}` convierte un `npx @angular/cli
// mcp` inofensivo en código del repo. Por eso el aviso enseña TODO, y las variables que inyectan código
// en el intérprete bloquean el servidor: un repo no tiene motivo legítimo para fijarlas.

const CODE_LOADING_ENV = /^(NODE_OPTIONS|NODE_PATH|LD_.+|DYLD_.+|PYTHONSTARTUP|PYTHONPATH|PYTHONHOME|PERL5OPT|PERL5LIB|RUBYOPT|RUBYLIB|BASH_ENV|ENV|PROMPT_COMMAND|JAVA_TOOL_OPTIONS|_JAVA_OPTIONS|JDK_JAVA_OPTIONS|DOTNET_STARTUP_HOOKS|NPM_CONFIG_.+|ELECTRON_RUN_AS_NODE|GIT_.+)$/i;
const PATH_ENV = /^PATH$/i;

const SECRET_NAME = /(token|secret|password|passwd|pass|key|auth|cookie|credential)/i;
const shown = (name, value) => (SECRET_NAME.test(name) && !/^\$\{\w+\}$/.test(String(value)) ? '***' : String(value));

// Riesgos de un servidor: `blocked` impide arrancarlo; `warnings` se enseñan en la aprobación.
export function mcpServerRisks(cfg = {}, { projectPath } = {}) {
  const blocked = [];
  const warnings = [];
  for (const name of Object.keys(cfg.env || {})) {
    if (CODE_LOADING_ENV.test(name)) blocked.push(`env ${name} can load code into the server process`);
    else if (PATH_ENV.test(name)) warnings.push(`env ${name} changes which binaries run`);
  }
  if (cfg.cwd && projectPath) {
    const rel = relative(resolve(projectPath), resolve(projectPath, String(cfg.cwd)));
    if (rel.split(/[\\/]/)[0] === '..' || isAbsolute(rel)) warnings.push(`cwd is outside the project: ${cfg.cwd}`);
  }
  return { blocked, warnings };
}

// Las líneas que ve el humano antes de aprobar: transporte, directorio, entorno y cabeceras.
export function describeMcpServer(cfg = {}, { projectPath } = {}) {
  const lines = [cfg.url ? String(cfg.url) : [cfg.command, ...(cfg.args || [])].join(' ')];
  if (cfg.cwd) lines.push(`cwd: ${cfg.cwd}`);
  for (const [name, value] of Object.entries(cfg.env || {})) lines.push(`env: ${name}=${shown(name, value)}`);
  for (const name of Object.keys(cfg.headers || {})) lines.push(`header: ${name}`);
  const { warnings, blocked } = mcpServerRisks(cfg, { projectPath });
  return { lines, warnings: [...blocked, ...warnings] };
}
