// Target: GitHub Copilot
//   - .github/copilot-instructions.md   (instrucciones repo-wide; bloque gestionado)
//   - .vscode/mcp.json                  (servidores MCP, clave "servers", type stdio)
//   - .chalc/skills/<id>/                 (skills copiados; se referencian en las instrucciones)
//   - .chalc.json                         (manifiesto)

import { join } from 'node:path';
import * as kit from '../lib/targetkit.mjs';

export const label = 'GitHub Copilot';

export async function apply({ projectPath, CATALOG, skills, mcps, methods, stacks, dryRun }) {
  const plan = [];
  for (const s of skills) plan.push(`skill     .chalc/skills/${s}`);
  for (const m of mcps) plan.push(`mcp       .vscode/mcp.json  ::  ${m.id}`);
  for (const me of methods) plan.push(`método    ${me.id}${me.mode && me.mode !== 'default' ? ` (${me.mode})` : ''}`);
  plan.push('rules     .github/copilot-instructions.md');
  plan.push('manifest  .chalc.json');
  if (dryRun) return { plan, written: false };

  await kit.copySkills(CATALOG, skills, join(projectPath, '.chalc', 'skills'));

  const metas = await Promise.all(skills.map((s) => kit.readSkillMeta(CATALOG, s)));
  const lines = [kit.START, '## ⚙️ Chalc'];
  if (metas.length) {
    lines.push('', '### Skills disponibles', '_Cuando la tarea lo amerite, lee el archivo indicado:_',
      ...metas.map((m) => `- **${m.name}** — ${m.description} → \`.chalc/skills/${m.id}/SKILL.md\``));
  }
  if (mcps.length) lines.push('', '### Servidores MCP', ...mcps.map((m) => `- \`${m.id}\` — ${m.description || ''}`));
  for (const me of methods) lines.push('', me.rulesText.trim());
  lines.push(kit.END);
  await kit.writeManagedBlock(join(projectPath, '.github', 'copilot-instructions.md'), lines.join('\n'));

  if (mcps.length) {
    await kit.mergeJson(join(projectPath, '.vscode', 'mcp.json'), (j) => {
      j.servers = j.servers || {};
      for (const m of mcps) j.servers[m.id] = { type: 'stdio', ...m.server };
    });
  }

  await kit.writeManifest(projectPath, 'copilot', stacks, skills, mcps, methods);
  return { plan, written: true };
}
