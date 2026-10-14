// Target: Antigravity (Google; IDE y CLI `agy`) — spec 021, R3.
//   - AGENTS.md                    (instrucciones del proyecto, estándar agents.md; bloque gestionado)
//   - .agents/skills/<id>/         (skills reales: Antigravity las carga solo, por su description)
//   - .agents/mcp_config.json      (servidores MCP del workspace, clave "mcpServers")
//   - .chalc.json                  (manifiesto)
//   - GEMINI.md                    (si lo dejó una versión anterior: pierde SOLO el bloque de chalc)
//
// Rutas de la documentación oficial (antigravity.google/docs: rules, skills, mcp; 2026-10-13).

import { applyAgentsTarget } from '../lib/targetkit/agentstarget.mjs';

export const label = 'Antigravity';

// Antigravity lee también GEMINI.md: el bloque de chalc de una versión anterior (el target gemini, retirado) se
// quita para no darle las reglas dos veces; lo del usuario se queda (R3, R6).
const HOOKS = { legacyFiles: [['GEMINI.md']] };

export const apply = (opts) => applyAgentsTarget('antigravity', opts, HOOKS);
