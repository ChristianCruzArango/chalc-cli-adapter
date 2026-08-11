// Target: GitHub Copilot
//   - .github/copilot-instructions.md   (instrucciones repo-wide; bloque gestionado)
//   - .vscode/mcp.json                  (servidores MCP, clave "servers", type stdio)
//   - .chalc/skills/<id>/                 (skills copiados; se referencian en las instrucciones)
//   - .chalc.json                         (manifiesto)

import { join } from 'node:path';
import * as kit from '../lib/targetkit.mjs';

export const label = 'GitHub Copilot';

export async function apply({ projectPath, CATALOG, skills, mcps, methods, stacks, architecture, specLang, dryRun , tools = null, roles = [] }) {
  const plan = [];
  for (const s of skills) plan.push(`skill     .chalc/skills/${s}`);
  for (const m of mcps) plan.push(`mcp       .vscode/mcp.json  ::  ${m.id}`);
  for (const me of methods) plan.push(`método    ${me.id}${me.mode && me.mode !== 'default' ? ` (${me.mode})` : ''}`);
  plan.push('rules     .github/copilot-instructions.md');
  plan.push('manifest  .chalc.json');
  if (dryRun) return { plan, written: false };

  await kit.copySkills(CATALOG, skills, join(projectPath, '.chalc', 'skills'), { tools });

  // Scaffold de los métodos (specs/ del SDD): contenido del proyecto, va con cualquier asistente.
  await kit.copyMethodScaffolds(methods, projectPath);

  const block = await kit.chalcBlock(CATALOG, { projectPath, skills, mcps, methods, roles, architecture, specLang });
  await kit.writeManagedBlock(join(projectPath, '.github', 'copilot-instructions.md'), block);

  if (mcps.length) {
    await kit.mergeJson(join(projectPath, '.vscode', 'mcp.json'), (j) => {
      j.servers = j.servers || {};
      for (const m of mcps) j.servers[m.id] = { type: 'stdio', ...m.server };
    });
  }

  await kit.writeManifest(projectPath, 'copilot', stacks, skills, mcps, methods);
  return { plan, written: true };
}
