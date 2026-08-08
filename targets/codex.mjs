// Target: Codex CLI (OpenAI)
//   - AGENTS.md                (instrucciones del proyecto, estándar agents.md; bloque gestionado)
//   - .codex/config.toml       (servidores MCP, tablas [mcp_servers.<id>]; bloque gestionado con #)
//   - .chalc/skills/<id>/        (skills copiados; referenciados en AGENTS.md)
//   - .chalc.json                (manifiesto)

import { join } from 'node:path';
import * as kit from '../lib/targetkit.mjs';

export const label = 'Codex CLI';

export async function apply({ projectPath, CATALOG, skills, mcps, methods, stacks, architecture, specLang, dryRun }) {
  const plan = [];
  for (const s of skills) plan.push(`skill     .chalc/skills/${s}`);
  for (const m of mcps) plan.push(`mcp       .codex/config.toml  ::  ${m.id}`);
  for (const me of methods) plan.push(`método    ${me.id}${me.mode && me.mode !== 'default' ? ` (${me.mode})` : ''}`);
  plan.push('rules     AGENTS.md');
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
  await kit.writeManagedBlock(join(projectPath, 'AGENTS.md'), lines.join('\n'));

  // MCP → .codex/config.toml. Sin parser TOML (cero dependencias): bloque gestionado con comentarios #,
  // igual que el bloque markdown — lo del usuario (model, profiles…) no se toca.
  if (mcps.length) {
    const block = [kit.TOML_START, kit.tomlMcpServers(mcps).trimEnd(), kit.TOML_END].join('\n');
    await kit.writeManagedBlock(join(projectPath, '.codex', 'config.toml'), block, { start: kit.TOML_START, end: kit.TOML_END });
  }

  await kit.writeManifest(projectPath, 'codex', stacks, skills, mcps, methods);
  return { plan, written: true };
}
