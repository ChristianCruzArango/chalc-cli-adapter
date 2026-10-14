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
import { applyAgentsTarget } from '../lib/targetkit/agentstarget.mjs';

export const label = 'Cursor';

const rulesDirOf = (projectPath) => join(projectPath, '.cursor', 'rules');

// Una regla por skill, que se carga por su description cuando aplica (el cuerpo apunta al contenido real).
async function writeSkillRules({ projectPath, CATALOG, skills, specLang }) {
  const metas = await Promise.all(skills.map((s) => kit.readSkillMeta(CATALOG, s)));
  for (const m of metas) {
    await writeFile(join(rulesDirOf(projectPath), `chalc-skill-${m.id}.mdc`), kit.mdc({
      description: m.description || m.name,
      alwaysApply: false,
      body: kit.blockText(specLang).skillRuleBody(m.name, m.id)
    }));
  }
}

// Quita las reglas chalc de una corrida anterior (no las del usuario).
async function cleanOldRules({ projectPath }) {
  const rulesDir = rulesDirOf(projectPath);
  await mkdir(rulesDir, { recursive: true });
  await kit.cleanPrefixed(rulesDir, 'chalc-', '.mdc');
}

const plan = ({ skills, mcps, methods }) => [
  ...skills.map((s) => `skill     .cursor/rules/chalc-skill-${s}.mdc  (+ .chalc/skills/${s})`),
  ...methods.map((me) => kit.methodPlanLine(me)),
  ...mcps.map((m) => `mcp       .cursor/mcp.json  ::  ${m.id}`),
  'rules     AGENTS.md',
  `command   ${kit.liveCommandFile('cursor')}`,
  'manifest  .chalc.json'
];

export const apply = (opts) => applyAgentsTarget('cursor', opts, { plan, beforeSkills: cleanOldRules, afterCommand: writeSkillRules });
