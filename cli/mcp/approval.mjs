// Política explícita para aprobar acciones MCP y locales.
// Principio base: DEFAULT-DENY. Ante lo desconocido —una tool local no catalogada, un modo mal escrito—
// se pide aprobación / se cae al lado MÁS estricto, nunca al permisivo. Así una tool nueva o un typo no
// concede ejecución por omisión.

// Un nombre es de solo-lectura si EMPIEZA por un verbo de lectura como segmento completo (seguido de _/-/fin),
// no como mero prefijo: 'getter'/'documentDelete'/'docker' NO cuentan.
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

export function isReadOnlyMcpTool(tool) {
  if (!String(tool || '').startsWith('mcp__')) return false;
  const name = String(tool).split('__').pop() || '';
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
