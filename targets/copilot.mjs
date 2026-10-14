// Target: GitHub Copilot
//   - AGENTS.md                         (instrucciones del proyecto, estándar agents.md; bloque gestionado — spec 021)
//     (un .github/copilot-instructions.md de una versión anterior pierde SOLO el bloque de chalc)
//   - .vscode/mcp.json                  (servidores MCP, clave "servers", type stdio)
//   - .chalc/skills/<id>/                 (skills copiados; se referencian en las instrucciones)
//   - .chalc.json                         (manifiesto)

import { join } from 'node:path';
import * as kit from '../lib/targetkit.mjs';

export const label = 'GitHub Copilot';

export async function apply({ projectPath, CATALOG, skills, mcps, methods, stacks, architecture, specLang, dryRun, tools = null, roles = [], force = false }) {
  const plan = [];
  for (const s of skills) plan.push(`skill     .chalc/skills/${s}`);
  for (const m of mcps) plan.push(`mcp       .vscode/mcp.json  ::  ${m.id}`);
  for (const me of methods) plan.push(kit.methodPlanLine(me));
  plan.push('rules     AGENTS.md');
  plan.push(`command   ${kit.liveCommandFile('copilot')}`);
  plan.push('manifest  .chalc.json');
  if (dryRun) return { plan, written: false };

  await kit.copySkills(CATALOG, skills, join(projectPath, '.chalc', 'skills'), { tools });

  // Scaffold de los métodos (specs/ del SDD): contenido del proyecto, va con cualquier asistente.
  await kit.copyMethodScaffolds(methods, projectPath);

  const block = await kit.chalcBlock(CATALOG, { projectPath, skills, mcps, methods, roles, architecture, specLang });
  await kit.writeManagedBlock(join(projectPath, 'AGENTS.md'), block);
  // El comando explícito que levanta el tablero (spec 021, R9).
  await kit.writeLiveCommand(projectPath, 'copilot', specLang);
  await kit.removeManagedBlock(join(projectPath, '.github', 'copilot-instructions.md'));

  if (mcps.length) {
    const servers = mcps.map((m) => ({ ...m, server: { type: 'stdio', ...m.server } }));
    await kit.mergeMcpServers(join(projectPath, '.vscode', 'mcp.json'), servers, { key: 'servers', force });
  }

  await kit.writeManifest(projectPath, 'copilot', { stacks, skills, mcps, methods, specLang, architecture });
  return { plan, written: true };
}
