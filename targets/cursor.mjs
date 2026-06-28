// Target: Cursor
//   - .cursor/rules/chalc-profile.mdc        (alwaysApply: perfil + convención)
//   - .cursor/rules/chalc-method-<id>.mdc    (alwaysApply: reglas del método, ej. SDD)
//   - .cursor/rules/chalc-skill-<id>.mdc     (alwaysApply:false: puntero al skill, con su description)
//   - .cursor/mcp.json                     (servidores MCP, clave "mcpServers")
//   - .chalc/skills/<id>/                    (skills copiados)
//   - .chalc.json                            (manifiesto)

import { join } from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
import * as kit from '../lib/targetkit.mjs';

export const label = 'Cursor';

export async function apply({ projectPath, CATALOG, skills, mcps, methods, stacks, architecture, dryRun }) {
  const plan = [];
  for (const s of skills) plan.push(`skill     .cursor/rules/chalc-skill-${s}.mdc  (+ .chalc/skills/${s})`);
  for (const me of methods) plan.push(`método    .cursor/rules/chalc-method-${me.id}.mdc`);
  for (const m of mcps) plan.push(`mcp       .cursor/mcp.json  ::  ${m.id}`);
  plan.push('manifest  .chalc.json');
  if (dryRun) return { plan, written: false };

  const rulesDir = join(projectPath, '.cursor', 'rules');
  await mkdir(rulesDir, { recursive: true });
  await kit.cleanPrefixed(rulesDir, 'chalc-', '.mdc');     // quita reglas Chalc obsoletas de una corrida anterior
  await kit.copySkills(CATALOG, skills, join(projectPath, '.chalc', 'skills'));

  // Scaffold de los métodos (specs/ del SDD): contenido del proyecto, va con cualquier asistente.
  await kit.copyMethodScaffolds(methods, projectPath);

  // principios obligatorios (siempre activos): implementación mínima + Clean Code + SOLID + arquitectura modular, prominentes
  const principles = kit.mandatoryPrinciplesBlock(skills);
  if (principles) {
    await writeFile(join(rulesDir, 'chalc-principles.mdc'), kit.mdc({
      description: 'Principios obligatorios del proyecto (Chalc)',
      alwaysApply: true,
      body: principles
    }));
  }

  // referencia a la arquitectura acordada (siempre activa): apunta a docs/architecture.md
  const archRef = kit.architectureBlock(projectPath, architecture?.name);
  if (archRef) {
    await writeFile(join(rulesDir, 'chalc-architecture.mdc'), kit.mdc({
      description: 'Arquitectura acordada del proyecto (Chalc)',
      alwaysApply: true,
      body: archRef
    }));
  }

  // métodos (siempre activos)
  for (const me of methods) {
    await writeFile(join(rulesDir, `chalc-method-${me.id}.mdc`), kit.mdc({
      description: `Método ${me.id}${me.mode && me.mode !== 'default' ? ` (${me.mode})` : ''} (Chalc)`,
      alwaysApply: true,
      body: me.rulesText
    }));
  }

  // skills (se cargan por description cuando aplican; el cuerpo apunta al contenido real)
  const metas = await Promise.all(skills.map((s) => kit.readSkillMeta(CATALOG, s)));
  for (const m of metas) {
    await writeFile(join(rulesDir, `chalc-skill-${m.id}.mdc`), kit.mdc({
      description: m.description || m.name,
      alwaysApply: false,
      body: `## ${m.name}\n\nCuando esta tarea aplique, sigue la skill completa en \`.chalc/skills/${m.id}/SKILL.md\`.`
    }));
  }

  if (mcps.length) {
    await kit.mergeJson(join(projectPath, '.cursor', 'mcp.json'), (j) => {
      j.mcpServers = j.mcpServers || {};
      for (const m of mcps) j.mcpServers[m.id] = m.server;
    });
  }

  await kit.writeManifest(projectPath, 'cursor', stacks, skills, mcps, methods);
  return { plan, written: true };
}
