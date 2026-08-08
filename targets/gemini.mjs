// Target: Gemini CLI
//   - GEMINI.md                 (contexto del proyecto; bloque gestionado)
//   - .gemini/settings.json     (servidores MCP, clave "mcpServers")
//   - .chalc/skills/<id>/         (skills copiados; referenciados en GEMINI.md)
//   - .chalc.json                 (manifiesto)

import { join } from 'node:path';
import * as kit from '../lib/targetkit.mjs';

export const label = 'Gemini CLI';

export async function apply({ projectPath, CATALOG, skills, mcps, methods, stacks, architecture, specLang, dryRun }) {
  const plan = [];
  for (const s of skills) plan.push(`skill     .chalc/skills/${s}`);
  for (const m of mcps) plan.push(`mcp       .gemini/settings.json  ::  ${m.id}`);
  for (const me of methods) plan.push(`método    ${me.id}${me.mode && me.mode !== 'default' ? ` (${me.mode})` : ''}`);
  plan.push('rules     GEMINI.md');
  plan.push('manifest  .chalc.json');
  if (dryRun) return { plan, written: false };

  await kit.copySkills(CATALOG, skills, join(projectPath, '.chalc', 'skills'));

  // Scaffold de los métodos (specs/ del SDD): contenido del proyecto, va con cualquier asistente.
  await kit.copyMethodScaffolds(methods, projectPath);

  const metas = await Promise.all(skills.map((s) => kit.readSkillMeta(CATALOG, s)));
  const lines = [kit.START, '## ⚙️ Chalc'];
  const principles = kit.mandatoryPrinciplesBlock(skills);
  if (principles) lines.push('', principles);
  const archRef = kit.architectureBlock(projectPath, architecture?.name);
  if (archRef) lines.push('', archRef);
  if (metas.length) {
    lines.push('', '### Skills disponibles', '_Cuando la tarea lo amerite, lee el archivo indicado:_',
      ...metas.map((m) => `- **${m.name}** — ${m.description} → \`.chalc/skills/${m.id}/SKILL.md\``));
  }
  if (mcps.length) lines.push('', '### Servidores MCP', ...mcps.map((m) => `- \`${m.id}\` — ${m.description || ''}`));
  for (const me of methods) lines.push('', me.rulesText.trim());
  // Revisor: aquí no hay subagentes, así que va como sección del mismo bloque gestionado (R12).
  lines.push(...await kit.reviewerLines(CATALOG, { skills, specLang }));
  lines.push(kit.END);
  await kit.writeManagedBlock(join(projectPath, 'GEMINI.md'), lines.join('\n'));

  if (mcps.length) {
    await kit.mergeJson(join(projectPath, '.gemini', 'settings.json'), (j) => {
      j.mcpServers = j.mcpServers || {};
      for (const m of mcps) j.mcpServers[m.id] = m.server;
    });
  }

  await kit.writeManifest(projectPath, 'gemini', stacks, skills, mcps, methods);
  return { plan, written: true };
}
