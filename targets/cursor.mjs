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

// Las reglas .mdc siempre activas: principios obligatorios (implementación mínima + Clean Code + SOLID
// + arquitectura modular, prominentes), la arquitectura acordada (apunta a docs/architecture.md) y
// las reglas de cada método.
function alwaysRules({ projectPath, skills, methods, architecture, specLang }) {
  const tx = kit.blockText(specLang);
  const rules = [];
  const principles = kit.mandatoryPrinciplesBlock(skills, specLang);
  if (principles) rules.push(['chalc-principles.mdc', tx.rulePrinciples, principles]);
  const archRef = kit.architectureBlock(projectPath, architecture?.name, specLang);
  if (archRef) rules.push(['chalc-architecture.mdc', tx.ruleArchitecture, archRef]);
  for (const me of methods) {
    rules.push([`chalc-method-${me.id}.mdc`, tx.ruleMethod(`${me.id}${me.mode && me.mode !== 'default' ? ` (${me.mode})` : ''}`), me.rulesText]);
  }
  return rules;
}

// Las reglas .mdc: las siempre activas y, por skill, una que se carga por description cuando aplica
// (el cuerpo apunta al contenido real).
async function writeRules(rulesDir, { projectPath, CATALOG, skills, methods, architecture, specLang }) {
  for (const [file, description, body] of alwaysRules({ projectPath, skills, methods, architecture, specLang })) {
    await writeFile(join(rulesDir, file), kit.mdc({ description, alwaysApply: true, body }));
  }
  const metas = await Promise.all(skills.map((s) => kit.readSkillMeta(CATALOG, s)));
  for (const m of metas) {
    await writeFile(join(rulesDir, `chalc-skill-${m.id}.mdc`), kit.mdc({
      description: m.description || m.name,
      alwaysApply: false,
      body: `## ${m.name}\n\nCuando esta tarea aplique, sigue la skill completa en \`.chalc/skills/${m.id}/SKILL.md\`.`
    }));
  }
}

export async function apply({ projectPath, CATALOG, skills, mcps, methods, stacks, architecture, specLang, dryRun, tools = null, roles = [], force = false }) {
  const plan = [
    ...skills.map((s) => `skill     .cursor/rules/chalc-skill-${s}.mdc  (+ .chalc/skills/${s})`),
    ...methods.map((me) => `método    .cursor/rules/chalc-method-${me.id}.mdc`),
    ...mcps.map((m) => `mcp       .cursor/mcp.json  ::  ${m.id}`),
    ...roles.map((role) => `agent     .cursor/rules/chalc-${role.id}.mdc`),
    'manifest  .chalc.json'
  ];
  if (dryRun) return { plan, written: false };

  const rulesDir = join(projectPath, '.cursor', 'rules');
  await mkdir(rulesDir, { recursive: true });
  await kit.cleanPrefixed(rulesDir, 'chalc-', '.mdc');     // quita reglas Chalc obsoletas de una corrida anterior
  await kit.copySkills(CATALOG, skills, join(projectPath, '.chalc', 'skills'), { tools });

  // Scaffold de los métodos (specs/ del SDD): contenido del proyecto, va con cualquier asistente.
  await kit.copyMethodScaffolds(methods, projectPath);

  // Revisor: en Cursor va como regla propia, para invocarlo al cerrar cada tarea (R12).
  for (const role of roles) await kit.writeRole(projectPath, CATALOG, role, { skills, specLang, kind: 'rule' });

  await writeRules(rulesDir, { projectPath, CATALOG, skills, methods, architecture, specLang });

  if (mcps.length) {
    await kit.mergeMcpServers(join(projectPath, '.cursor', 'mcp.json'), mcps, { force });
  }

  await kit.writeManifest(projectPath, 'cursor', stacks, skills, mcps, methods);
  return { plan, written: true };
}
