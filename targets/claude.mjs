// Target: Claude Code
// Traduce el catálogo neutro (skills + mcp + methods + stack) a los archivos de Claude Code:
//   - .claude/skills/<id>/      (copia real de cada skill)
//   - .mcp.json                 (servidores MCP, fusionado sin pisar lo existente)
//   - specs/ ...                (scaffold de los métodos, sin sobrescribir lo del usuario)
//   - CLAUDE.md                 (bloque gestionado: stack + skills + mcp + reglas de métodos)
//   - .chalc.json                 (manifiesto)

import { cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import * as kit from '../lib/targetkit.mjs';

export const label = 'Claude Code';

export async function apply({ projectPath, CATALOG, skills, mcps, methods, stacks, architecture, specLang, dryRun }) {
  const plan = [];
  for (const s of skills) plan.push(`skill     .claude/skills/${s}`);
  plan.push('agent     .claude/agents/revisor.md');
  plan.push('doc       .chalc/gate-hook.md  (hook opcional, para pegar a mano)');
  for (const m of mcps) plan.push(`mcp       .mcp.json  ::  ${m.id}`);
  for (const me of methods) plan.push(`método    ${me.id}${me.mode && me.mode !== 'default' ? ` (${me.mode})` : ''}  (scaffold + reglas)`);
  plan.push('rules     CLAUDE.md  (bloque chalc)');
  plan.push('manifest  .chalc.json');
  if (dryRun) return { plan, written: false };

  // 1) Skills
  await kit.copySkills(CATALOG, skills, join(projectPath, '.claude', 'skills'));

  // 2) MCP -> fusionar sin pisar otros servidores
  if (mcps.length) {
    await kit.mergeJson(join(projectPath, '.mcp.json'), (j) => {
      j.mcpServers = j.mcpServers || {};
      for (const m of mcps) j.mcpServers[m.id] = m.server;
    });
  }

  // 3) Métodos -> copiar scaffold (specs/ del SDD, sin sobrescribir archivos del usuario)
  await kit.copyMethodScaffolds(methods, projectPath);

  // 3b) Revisor: en Claude Code va como SUBAGENTE propio, no como un párrafo más de CLAUDE.md.
  // Así se invoca a voluntad al cerrar cada tarea, y sus herramientas son de solo lectura (R12).
  await kit.writeReviewer(projectPath, CATALOG, { skills, specLang, kind: 'agent' });

  // 3c) Hook de cierre de turno: se DOCUMENTA, no se instala. `.claude/settings.json` va commiteado,
  // así que activarlo aquí le ejecutaría un comando a todo el que clone el repo (R19).
  await kit.writeGateHookDoc(projectPath, CATALOG, { specLang });

  // 4) CLAUDE.md (bloque gestionado)
  const lines = [kit.START, '## ⚙️ Chalc'];
  const principles = kit.mandatoryPrinciplesBlock(skills);
  if (principles) lines.push('', principles);
  const archRef = kit.architectureBlock(projectPath, architecture?.name);
  if (archRef) lines.push('', archRef);
  if (skills.length) lines.push('', '### Skills activas', ...skills.map((s) => `- \`${s}\``));
  if (mcps.length) lines.push('', '### Servidores MCP', ...mcps.map((m) => `- \`${m.id}\` — ${m.description || ''}`));
  for (const me of methods) lines.push('', me.rulesText.trim());
  lines.push(kit.END);
  await kit.writeManagedBlock(join(projectPath, 'CLAUDE.md'), lines.join('\n'));

  // 5) Manifiesto
  await kit.writeManifest(projectPath, 'claude', stacks, skills, mcps, methods);

  return { plan, written: true };
}
