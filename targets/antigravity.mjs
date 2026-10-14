// Target: Antigravity (Google; IDE y CLI `agy`) — spec 021, R3.
//   - AGENTS.md                    (instrucciones del proyecto, estándar agents.md; bloque gestionado)
//   - .agents/skills/<id>/         (skills reales: Antigravity las carga solo, por su description)
//   - .agents/mcp_config.json      (servidores MCP del workspace, clave "mcpServers")
//   - .chalc.json                  (manifiesto)
//   - GEMINI.md                    (si lo dejó una versión anterior: pierde SOLO el bloque de chalc)
//
// Rutas de la documentación oficial (antigravity.google/docs: rules, skills, mcp; 2026-10-13).

import { join } from 'node:path';
import * as kit from '../lib/targetkit.mjs';

export const label = 'Antigravity';

const SKILLS_DIR = '.agents/skills';

export async function apply({ projectPath, CATALOG, skills, mcps, methods, stacks, architecture, specLang, dryRun, tools = null, roles = [], force = false }) {
  const plan = [];
  for (const s of skills) plan.push(`skill     ${SKILLS_DIR}/${s}`);
  for (const m of mcps) plan.push(`mcp       .agents/mcp_config.json  ::  ${m.id}`);
  for (const me of methods) plan.push(kit.methodPlanLine(me));
  plan.push('rules     AGENTS.md');
  plan.push(`command   ${kit.liveCommandFile('antigravity')}`);
  plan.push('manifest  .chalc.json');
  if (dryRun) return { plan, written: false };

  await kit.copySkills(CATALOG, skills, join(projectPath, '.agents', 'skills'), { tools });

  // Scaffold de los métodos (specs/ del SDD): contenido del proyecto, va con cualquier asistente.
  await kit.copyMethodScaffolds(methods, projectPath);

  const block = await kit.chalcBlock(CATALOG, { projectPath, skills, mcps, methods, roles, architecture, specLang, skillsDir: SKILLS_DIR });
  await kit.writeManagedBlock(join(projectPath, 'AGENTS.md'), block);
  // El comando explícito que levanta el tablero (spec 021, R9).
  await kit.writeLiveCommand(projectPath, 'antigravity', specLang);
  // Antigravity lee también GEMINI.md: el bloque de chalc de una versión anterior (el target gemini, retirado) se
  // quita para no darle las reglas dos veces; lo del usuario se queda (R3, R6).
  await kit.removeManagedBlock(join(projectPath, 'GEMINI.md'));

  if (mcps.length) {
    await kit.mergeMcpServers(join(projectPath, '.agents', 'mcp_config.json'), mcps, { force });
  }

  await kit.writeManifest(projectPath, 'antigravity', { stacks, skills, mcps, methods, specLang, architecture });
  return { plan, written: true };
}
