// Target: Claude Code
// Traduce el catálogo neutro (skills + mcp + methods + stack) a los archivos de Claude Code:
//   - .claude/skills/<id>/      (copia real de cada skill)
//   - .mcp.json                 (servidores MCP, fusionado sin pisar lo existente)
//   - specs/ ...                (scaffold de los métodos, sin sobrescribir lo del usuario)
//   - CLAUDE.md                 (bloque gestionado: stack + skills + mcp + reglas de métodos)
//   - .chalc.json                 (manifiesto)

import { cp } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as kit from '../lib/targetkit.mjs';

export const label = 'Claude Code';

function planOf({ skills, mcps, methods, roles }) {
  const plan = [];
  for (const s of skills) plan.push(`skill     .claude/skills/${s}`);
  for (const role of roles) plan.push(`agent     .claude/agents/${role.id}.md`);
  plan.push(`doc       .chalc/gate-hook.md  ${kit.planNote('planHookOptional')}`);
  for (const m of mcps) plan.push(`mcp       .mcp.json  ::  ${m.id}`);
  for (const me of methods) plan.push(kit.methodPlanLine(me, kit.planNote('planScaffoldRules')));
  plan.push(`rules     CLAUDE.md  ${kit.planNote('planChalcBlock')}`);
  plan.push(`command   ${kit.liveCommandFile('claude')}`);
  plan.push('manifest  .chalc.json');
  return plan;
}

// El bloque de CLAUDE.md que chalc gestiona: lo común a todo target (kit.blockSections) y, en medio,
// las skills activas — Claude Code las carga solo de .claude/skills, así que basta con nombrarlas.
// Los roles no van aquí: en Claude son subagentes propios (.claude/agents).
//
// Con AGENTS.md en el proyecto, Claude Code solo lo lee si CLAUDE.md lo importa (spec 021, R5): se importa.
// Y si AGENTS.md ya lleva el bloque de chalc (el repo está equipado también para otro harness), lo común no se
// repite aquí: quedan el import y lo propio de Claude, sus skills activas.
function managedBlock({ projectPath, skills, mcps, methods, architecture, specLang }) {
  const agents = agentsFile(projectPath);
  const { head, tail } = agents.hasChalc ? { head: [], tail: [] } : kit.blockSections({ projectPath, skills, mcps, methods, architecture, specLang });
  const active = skills.length ? ['', `### ${kit.blockText(specLang).skillsActive}`, ...skills.map((s) => `- \`${s}\``)] : [];
  const imported = agents.exists ? ['', '@AGENTS.md'] : [];
  return [kit.START, '## ⚙️ Chalc', ...imported, ...head, ...active, ...tail, kit.END].join('\n');
}

// ¿Tiene el proyecto AGENTS.md, y lleva ya el bloque de chalc?
function agentsFile(projectPath) {
  const path = join(projectPath, 'AGENTS.md');
  if (!existsSync(path)) return { exists: false, hasChalc: false };
  return { exists: true, hasChalc: readFileSync(path, 'utf8').includes(kit.START) };
}

export async function apply({ projectPath, CATALOG, skills, mcps, methods, stacks, architecture, specLang, dryRun, tools = null, roles = [], force = false }) {
  const plan = planOf({ skills, mcps, methods, roles });
  if (dryRun) return { plan, written: false };

  // 1) Skills
  await kit.copySkills(CATALOG, skills, join(projectPath, '.claude', 'skills'), { tools, specLang });

  // 2) MCP -> fusionar sin pisar otros servidores
  if (mcps.length) {
    await kit.mergeMcpServers(join(projectPath, '.mcp.json'), mcps, { force });
  }

  // 3) Métodos -> copiar scaffold (specs/ del SDD, sin sobrescribir archivos del usuario)
  await kit.copyMethodScaffolds(methods, projectPath);

  // 3b) Revisor: en Claude Code va como SUBAGENTE propio, no como un párrafo más de CLAUDE.md.
  // Así se invoca a voluntad al cerrar cada tarea, y sus herramientas son de solo lectura (R12).
  for (const role of roles) await kit.writeRole(projectPath, CATALOG, role, { skills, specLang });

  // 3c) Hook de cierre de turno: se DOCUMENTA, no se instala. `.claude/settings.json` va commiteado,
  // así que activarlo aquí le ejecutaría un comando a todo el que clone el repo (R19). La guarda de commit y
  // push es la única que chalc instala, y no desde aquí: solo con `--guard` y solo en el archivo LOCAL
  // (`lib/commands/guardstep.mjs`; la spec 023 enmienda 007 R19 / 017 R7).
  await kit.writeGateHookDoc(projectPath, CATALOG, { specLang });

  // 4) CLAUDE.md (bloque gestionado)
  await kit.writeManagedBlock(join(projectPath, 'CLAUDE.md'), managedBlock({ projectPath, skills, mcps, methods, architecture, specLang }));

  // 4b) El comando explícito que levanta el tablero (spec 021, R9): `/chalc-live`.
  await kit.writeLiveCommand(projectPath, 'claude', specLang);

  // 5) Manifiesto
  await kit.writeManifest(projectPath, 'claude', { stacks, skills, mcps, methods, specLang, architecture });

  return { plan, written: true };
}
