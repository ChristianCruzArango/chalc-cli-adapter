// Target: Cursor
//   - AGENTS.md                              (instrucciones del proyecto, estándar agents.md; bloque gestionado — spec 021)
//   - .cursor/rules/chalc-skill-<id>.mdc     (alwaysApply:false: puntero al skill, se carga por su description)
//   - .cursor/mcp.json                       (servidores MCP, clave "mcpServers")
//   - .chalc/skills/<id>/                    (skills copiados)
//   - .chalc.json                            (manifiesto)
//
// Cursor lee AGENTS.md (documentación oficial): principios, arquitectura, métodos y roles van ahí, como en el
// resto de harness. En `.cursor/rules/` queda solo lo que AGENTS.md no sabe hacer: una regla por skill que Cursor
// carga cuando su descripción aplica. Las reglas `chalc-*.mdc` de versiones anteriores se retiran; las del usuario,
// no.

import { join } from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
import * as kit from '../lib/targetkit.mjs';

export const label = 'Cursor';

// Una regla por skill, que se carga por su description cuando aplica (el cuerpo apunta al contenido real).
async function writeSkillRules(rulesDir, { CATALOG, skills, specLang }) {
  const metas = await Promise.all(skills.map((s) => kit.readSkillMeta(CATALOG, s)));
  for (const m of metas) {
    await writeFile(join(rulesDir, `chalc-skill-${m.id}.mdc`), kit.mdc({
      description: m.description || m.name,
      alwaysApply: false,
      body: kit.blockText(specLang).skillRuleBody(m.name, m.id)
    }));
  }
}

export async function apply({ projectPath, CATALOG, skills, mcps, methods, stacks, architecture, specLang, dryRun, tools = null, roles = [], force = false }) {
  const plan = [
    ...skills.map((s) => `skill     .cursor/rules/chalc-skill-${s}.mdc  (+ .chalc/skills/${s})`),
    ...methods.map((me) => kit.methodPlanLine(me)),
    ...mcps.map((m) => `mcp       .cursor/mcp.json  ::  ${m.id}`),
    'rules     AGENTS.md',
    `command   ${kit.liveCommandFile('cursor')}`,
    'manifest  .chalc.json'
  ];
  if (dryRun) return { plan, written: false };

  const rulesDir = join(projectPath, '.cursor', 'rules');
  await mkdir(rulesDir, { recursive: true });
  await kit.cleanPrefixed(rulesDir, 'chalc-', '.mdc');     // quita reglas chalc de una corrida anterior (no las del usuario)
  await kit.copySkills(CATALOG, skills, join(projectPath, '.chalc', 'skills'), { tools });

  // Scaffold de los métodos (specs/ del SDD): contenido del proyecto, va con cualquier asistente.
  await kit.copyMethodScaffolds(methods, projectPath);

  const block = await kit.chalcBlock(CATALOG, { projectPath, skills, mcps, methods, roles, architecture, specLang });
  await kit.writeManagedBlock(join(projectPath, 'AGENTS.md'), block);
  // El comando explícito que levanta el tablero (spec 021, R9).
  await kit.writeLiveCommand(projectPath, 'cursor', specLang);
  await writeSkillRules(rulesDir, { CATALOG, skills, specLang });

  if (mcps.length) {
    await kit.mergeMcpServers(join(projectPath, '.cursor', 'mcp.json'), mcps, { force });
  }

  await kit.writeManifest(projectPath, 'cursor', { stacks, skills, mcps, methods, specLang, architecture });
  return { plan, written: true };
}
