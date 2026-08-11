// Target: Codex CLI (OpenAI)
//   - AGENTS.md                (instrucciones del proyecto, estándar agents.md; bloque gestionado)
//   - .codex/config.toml       (servidores MCP, tablas [mcp_servers.<id>]; bloque gestionado con #)
//   - .chalc/skills/<id>/        (skills copiados; referenciados en AGENTS.md)
//   - .chalc.json                (manifiesto)

import { join } from 'node:path';
import * as kit from '../lib/targetkit.mjs';

export const label = 'Codex CLI';

export async function apply({ projectPath, CATALOG, skills, mcps, methods, stacks, architecture, specLang, dryRun , tools = null, roles = [] }) {
  const plan = [];
  for (const s of skills) plan.push(`skill     .chalc/skills/${s}`);
  for (const m of mcps) plan.push(`mcp       .codex/config.toml  ::  ${m.id}`);
  for (const me of methods) plan.push(`método    ${me.id}${me.mode && me.mode !== 'default' ? ` (${me.mode})` : ''}`);
  plan.push('rules     AGENTS.md');
  plan.push('manifest  .chalc.json');
  if (dryRun) return { plan, written: false };

  await kit.copySkills(CATALOG, skills, join(projectPath, '.chalc', 'skills'), { tools });

  // Scaffold de los métodos (specs/ del SDD): contenido del proyecto, va con cualquier asistente.
  await kit.copyMethodScaffolds(methods, projectPath);

  const block = await kit.chalcBlock(CATALOG, { projectPath, skills, mcps, methods, roles, architecture, specLang });
  await kit.writeManagedBlock(join(projectPath, 'AGENTS.md'), block);

  // MCP → .codex/config.toml. Sin parser TOML (cero dependencias): bloque gestionado con comentarios #,
  // igual que el bloque markdown — lo del usuario (model, profiles…) no se toca.
  if (mcps.length) {
    const block = [kit.TOML_START, kit.tomlMcpServers(mcps).trimEnd(), kit.TOML_END].join('\n');
    await kit.writeManagedBlock(join(projectPath, '.codex', 'config.toml'), block, { start: kit.TOML_START, end: kit.TOML_END });
  }

  await kit.writeManifest(projectPath, 'codex', stacks, skills, mcps, methods);
  return { plan, written: true };
}
