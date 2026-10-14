// Target: GitHub Copilot
//   - AGENTS.md                         (instrucciones del proyecto, estándar agents.md; bloque gestionado — spec 021)
//     (un .github/copilot-instructions.md de una versión anterior pierde SOLO el bloque de chalc)
//   - .vscode/mcp.json                  (servidores MCP, clave "servers", type stdio)
//   - .chalc/skills/<id>/                 (skills copiados; se referencian en las instrucciones)
//   - .chalc.json                         (manifiesto)

import { applyAgentsTarget } from '../lib/targetkit/agentstarget.mjs';

export const label = 'GitHub Copilot';

const HOOKS = {
  legacyFiles: [['.github', 'copilot-instructions.md']],
  mcpServers: (mcps) => mcps.map((m) => ({ ...m, server: { type: 'stdio', ...m.server } }))
};

export const apply = (opts) => applyAgentsTarget('copilot', opts, HOOKS);
