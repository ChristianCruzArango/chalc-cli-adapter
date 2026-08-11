// Target: Gemini CLI
//   - GEMINI.md                 (contexto del proyecto; bloque gestionado)
//   - .gemini/settings.json     (servidores MCP, clave "mcpServers")
//   - .chalc/skills/<id>/         (skills copiados; referenciados en GEMINI.md)
//   - .chalc.json                 (manifiesto)

import { join } from 'node:path';
import * as kit from '../lib/targetkit.mjs';

export const label = 'Gemini CLI';

export async function apply({ projectPath, CATALOG, skills, mcps, methods, stacks, architecture, specLang, dryRun , tools = null, roles = [] }) {
  const plan = [];
  for (const s of skills) plan.push(`skill     .chalc/skills/${s}`);
  for (const m of mcps) plan.push(`mcp       .gemini/settings.json  ::  ${m.id}`);
  for (const me of methods) plan.push(`método    ${me.id}${me.mode && me.mode !== 'default' ? ` (${me.mode})` : ''}`);
  plan.push('rules     GEMINI.md');
  plan.push('manifest  .chalc.json');
  if (dryRun) return { plan, written: false };

  await kit.copySkills(CATALOG, skills, join(projectPath, '.chalc', 'skills'), { tools });

  // Scaffold de los métodos (specs/ del SDD): contenido del proyecto, va con cualquier asistente.
  await kit.copyMethodScaffolds(methods, projectPath);

  const block = await kit.chalcBlock(CATALOG, { projectPath, skills, mcps, methods, roles, architecture, specLang });
  await kit.writeManagedBlock(join(projectPath, 'GEMINI.md'), block);

  if (mcps.length) {
    await kit.mergeJson(join(projectPath, '.gemini', 'settings.json'), (j) => {
      j.mcpServers = j.mcpServers || {};
      for (const m of mcps) j.mcpServers[m.id] = m.server;
    });
  }

  await kit.writeManifest(projectPath, 'gemini', stacks, skills, mcps, methods);
  return { plan, written: true };
}
