// lib/targetfiles.mjs — qué archivos escribe cada target (spec 021, R7). Responsabilidad ÚNICA: el mapa de
// dónde deja cada harness sus instrucciones, skills y MCP. Razón de cambio: un harness cambia dónde lee.
//
// Antes había dos copias (verify y la CLI) con un «VERIFICADO contra targets/*.mjs» que nadie comprobaba; ahora
// hay una, y `test/target-files.test.mjs` la contrasta con lo que cada target escribe de verdad al equipar.
//
// skillsDir: carpeta con <id>/SKILL.md · mcpFile: archivo de MCP · mcpKey: clave de los servidores ·
// rulesFile: archivo de instrucciones. Todos leen `AGENTS.md` salvo Claude Code, que tiene `CLAUDE.md`
// (documentación oficial de cada uno, 2026-10-13; detalle en specs/021-agents-md/spec.md).

export const TARGET_LAYOUT = {
  claude:      { skillsDir: ['.claude', 'skills'], mcpFile: ['.mcp.json'],                 mcpKey: 'mcpServers', rulesFile: ['CLAUDE.md'] },
  codex:       { skillsDir: ['.chalc', 'skills'],  mcpFile: ['.codex', 'config.toml'],     mcpKey: 'mcp_servers', rulesFile: ['AGENTS.md'], mcpFormat: 'toml' },
  copilot:     { skillsDir: ['.chalc', 'skills'],  mcpFile: ['.vscode', 'mcp.json'],       mcpKey: 'servers',    rulesFile: ['AGENTS.md'] },
  cursor:      { skillsDir: ['.chalc', 'skills'],  mcpFile: ['.cursor', 'mcp.json'],       mcpKey: 'mcpServers', rulesFile: ['AGENTS.md'] },
  antigravity: { skillsDir: ['.agents', 'skills'], mcpFile: ['.agents', 'mcp_config.json'], mcpKey: 'mcpServers', rulesFile: ['AGENTS.md'] }
};

// Targets retirados y su reemplazo (spec 021, R2). Gemini CLI dejó de funcionar para cuentas individuales el
// 2026-06-18 (anuncio oficial de Google del 2026-05-19); lo reemplaza Antigravity CLI. Pedirlo es un error claro.
export const RETIRED_TARGETS = { gemini: 'antigravity' };

/** El archivo de instrucciones de un target, como ruta con '/'; '' si el target no existe. */
export const rulesFileOf = (target) => TARGET_LAYOUT[target]?.rulesFile.join('/') || '';
