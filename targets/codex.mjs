// Target: Codex CLI (OpenAI)
//   - AGENTS.md                (instrucciones del proyecto, estándar agents.md; bloque gestionado)
//   - .codex/config.toml       (servidores MCP, tablas [mcp_servers.<id>]; bloque gestionado con #)
//   - .chalc/skills/<id>/        (skills copiados; referenciados en AGENTS.md)
//   - .chalc.json                (manifiesto)
//
// La secuencia es la común de los targets de AGENTS.md (lib/targetkit/agentstarget.mjs); el MCP en TOML lo
// decide la fila de TARGET_LAYOUT (`mcpFormat: 'toml'`).

import { applyAgentsTarget } from '../lib/targetkit/agentstarget.mjs';

export const label = 'Codex CLI';

export const apply = (opts) => applyAgentsTarget('codex', opts);
