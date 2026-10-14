// lib/targetkit/agentstarget.mjs — la secuencia de equipado de los targets que leen AGENTS.md (spec 022, C1).
// Responsabilidad ÚNICA: los siete pasos comunes (skills → scaffold de métodos → bloque → AGENTS.md → comando
// `chalc-live` → servidores MCP → manifiesto), parametrizados por la fila de TARGET_LAYOUT. Razón de cambio: qué
// hace chalc al equipar un harness. Antes cada target repetía la secuencia y cualquiera podía olvidar un paso.
//
// Lo que distingue a cada target entra por `hooks`:
//   plan(opts)            → su plan, si no le vale el de por defecto
//   beforeSkills(opts)    → antes de copiar skills (Cursor retira sus reglas viejas)
//   afterCommand(opts)    → tras el comando `chalc-live` (Cursor escribe una regla por skill)
//   legacyFiles           → archivos de versiones anteriores que pierden SOLO el bloque de chalc
//   mcpServers(mcps)      → cómo quiere el harness cada servidor (Copilot añade `type: stdio`)

import { join } from 'node:path';
import { TARGET_LAYOUT } from '../targetfiles.mjs';
import { copySkills, copyMethodScaffolds, chalcBlock, mergeMcpServers, writeManifest } from '../targetkit.mjs';
import { TOML_START, TOML_END, writeManagedBlock, removeManagedBlock, tomlMcpServers } from './formats.mjs';
import { methodPlanLine } from './plan.mjs';
import { liveCommandFile, writeLiveCommand } from './livecommand.mjs';

const rel = (parts) => parts.join('/');

/** El plan de por defecto: lo que dice la fila del layout, en el orden de siempre. */
export function defaultPlan(target, { skills, mcps, methods }) {
  const layout = TARGET_LAYOUT[target];
  return [
    ...skills.map((s) => `skill     ${rel(layout.skillsDir)}/${s}`),
    ...mcps.map((m) => `mcp       ${rel(layout.mcpFile)}  ::  ${m.id}`),
    ...methods.map((me) => methodPlanLine(me)),
    `rules     ${rel(layout.rulesFile)}`,
    `command   ${liveCommandFile(target)}`,
    'manifest  .chalc.json'
  ];
}

// MCP en TOML (Codex): sin parser (cero dependencias), bloque gestionado con comentarios #; lo del usuario
// (model, profiles…) no se toca. En JSON: se fusiona bajo la clave del layout sin pisar lo del usuario.
async function writeMcp(projectPath, layout, servers, force) {
  const file = join(projectPath, ...layout.mcpFile);
  if (layout.mcpFormat === 'toml') {
    const block = [TOML_START, tomlMcpServers(servers).trimEnd(), TOML_END].join('\n');
    await writeManagedBlock(file, block, { start: TOML_START, end: TOML_END });
    return;
  }
  await mergeMcpServers(file, servers, { key: layout.mcpKey, force });
}

/** Equipa `target` (una fila de TARGET_LAYOUT que lee AGENTS.md) con las opciones de `apply`. */
export async function applyAgentsTarget(target, opts, hooks = {}) {
  const layout = TARGET_LAYOUT[target];
  const { projectPath, CATALOG, skills, mcps, methods, stacks, architecture, specLang, dryRun, tools = null, roles = [], force = false } = opts;
  const plan = hooks.plan ? hooks.plan(opts) : defaultPlan(target, opts);
  if (dryRun) return { plan, written: false };

  await hooks.beforeSkills?.(opts);
  await copySkills(CATALOG, skills, join(projectPath, ...layout.skillsDir), { tools, specLang });
  // Scaffold de los métodos (specs/ del SDD): contenido del proyecto, va con cualquier asistente.
  await copyMethodScaffolds(methods, projectPath);

  const block = await chalcBlock(CATALOG, { projectPath, skills, mcps, methods, roles, architecture, specLang, skillsDir: rel(layout.skillsDir) });
  await writeManagedBlock(join(projectPath, ...layout.rulesFile), block);
  // El comando explícito que levanta el tablero (spec 021, R9).
  await writeLiveCommand(projectPath, target, specLang);
  // Stryker disable next-line ArrayDeclaration: quitar el bloque de un archivo inexistente no escribe nada
  for (const legacy of hooks.legacyFiles || []) await removeManagedBlock(join(projectPath, ...legacy));
  await hooks.afterCommand?.(opts);

  if (mcps.length) await writeMcp(projectPath, layout, hooks.mcpServers ? hooks.mcpServers(mcps) : mcps, force);

  await writeManifest(projectPath, target, { stacks, skills, mcps, methods, specLang, architecture });
  return { plan, written: true };
}
