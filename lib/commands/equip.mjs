// Equipamiento de proyectos: scaffold SDD y proyección de skills/MCP/métodos vía el target.
// Lo reutilizan apply, spec, spec-ia, feature e init.

import { cp, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { lang, t } from '../i18n.mjs';
import { assertSafeId } from '../ids.mjs';
import { detectContext, matchRules } from '../detect.mjs';
import { CATALOG, METHODS_DIR, RULES_DIR, TARGETS_DIR, c } from './context.mjs';
import { deepSub, langCode, loadJsonDir, loadMcp, loadMethods } from './catalogstore.mjs';
import { emitGate } from '../gateemit.mjs';
import { emitNext } from '../nextemit.mjs';
import { emitMail } from '../mailemit.mjs';
import { loadToolTable, resolveStack, resolveTools } from '../tooltable.mjs';
import { loadRoles } from '../roles.mjs';

// Aviso por consola de que el repo ya tiene portón. Si la detección no supo resolver algo (un stack
// sin herramienta estándar, un `test` que no corre nada), se dice AQUÍ y no al primer bloqueo: el
// usuario acaba de equipar y es cuando puede arreglarlo en un minuto.
function gateNotice(config) {
  console.log(c.dim('  ' + t('gateReady')));
  if (config.pending?.length) console.log(c.yellow('  ' + t('gatePending', config.pending.join(', '))));
}

// Targets que conceden permisos POR AGENTE. En los demás, el alcance de un rol es una instrucción
// que nada impide saltarse (spec 009, R5), y el usuario merece saber cuál de las dos cosas compró.
const ENFORCES_SCOPE = new Set(['claude']);

function rolesNotice(roles, targetName) {
  if (!roles.length) return;
  const ids = roles.map((r) => r.id).join(', ');
  const key = ENFORCES_SCOPE.has(targetName) ? 'rolesEnforced' : 'rolesAdvisory';
  console.log(c.dim('  ' + t(key, ids)));
}

export async function ensureSddScaffold(projectPath, mode = 'lite') {
  const specsDir = join(projectPath, 'specs');
  const templateDir = join(specsDir, '_template');
  if (existsSync(templateDir) && existsSync(join(specsDir, 'constitution.md'))) return specsDir;

  const base = mode === 'full' ? 'scaffold-full' : 'scaffold-lite';
  const scaffoldName = (lang === 'en' && existsSync(join(METHODS_DIR, 'sdd', `${base}-en`))) ? `${base}-en` : base;
  const scaffoldDir = join(METHODS_DIR, 'sdd', scaffoldName);
  if (!existsSync(scaffoldDir)) throw new Error(`No existe el scaffold SDD: ${scaffoldName}`);
  await cp(scaffoldDir, projectPath, { recursive: true, force: false, errorOnExist: false, dereference: true });
  await mkdir(specsDir, { recursive: true });
  return specsDir;
}

// Equipa el proyecto para spec-ia: skills (incl. mutation-testing global) + MCP + método SDD + el
// portón de calidad, vía el target. Devuelve la lista de skills equipadas (para el hand-off).
//
// El portón se emite AQUÍ y no en un comando propio porque este es el punto por el que pasan los
// tres consumidores: `spec-ia` con un repo, `feature` con back/front/móvil, y `feature` en modo
// worktree con la ruta de cada worktree. Emitir aquí los cubre a los tres —y cumple R15 por
// construcción: si `proj` es el worktree, el repo principal no se toca.
export async function equipForSpec(proj, mode, targetName, specLang, { role = '' } = {}) {
  targetName = assertSafeId(targetName, 'target');
  const ctx = await detectContext(proj);
  const rules = await loadJsonDir(RULES_DIR);
  const matched = matchRules(rules, ctx);
  const stacks = matched.filter((r) => !r.always);
  const skills = [...new Set(matched.flatMap((r) => r.skills || []))];
  const mcpIds = [...new Set(matched.flatMap((r) => r.mcp || []))];   // obligatorios; los opcionales (secretos) se omiten
  const mcps = await Promise.all(mcpIds.map(async (id) => {
    const def = await loadMcp(id);
    return { id: def.id, description: def.description, server: deepSub(def.server, { PROJECT: proj }) };
  }));
  // El método (constitución/plantillas/reglas) se monta en el idioma del SPEC, no el del CLI.
  const sdd = (await loadMethods(langCode(specLang))).find((x) => x.id === 'sdd');
  const m = sdd && (sdd.modes.find((x) => x.id === mode) || sdd.modes[0]);
  const methods = m ? [{ id: sdd.id, label: sdd.label, mode: m.id, scaffoldDir: m.scaffoldDir, rulesText: m.rulesText }] : [];
  const targetFile = join(TARGETS_DIR, `${targetName}.mjs`);
  const target = existsSync(targetFile)
    ? await import(pathToFileURL(targetFile).href)
    : await import(pathToFileURL(join(TARGETS_DIR, 'claude.mjs')).href);
  // El stack del repo y lo que la tabla resolvió para él (spec 011, R9): con eso la skill
  // `mutation-testing` llega aterrizada en ESTE repo en vez de con la tabla de nueve lenguajes.
  const table = await loadToolTable();
  const toolStack = resolveStack(table, ctx);
  const tools = {
    stacks: table,
    stack: toolStack,
    tools: toolStack ? await resolveTools(toolStack, proj, ctx) : null
  };
  // Los roles de revisión salen de sus contratos (spec 009, R2): el target los proyecta todos, con
  // los permisos que cada contrato declara. Antes había uno solo, cableado.
  const roles = await loadRoles();
  rolesNotice(roles, targetName);
  // `specLang` viaja al target porque los roles se escriben en el idioma del spec, igual que el método.
  await target.apply({ projectPath: proj, CATALOG, skills, mcps, methods, stacks, specLang, tools, roles, dryRun: false });
  // El portón, en el idioma del SPEC: vive en el repo del usuario, no en la consola de chalc.
  const { config } = await emitGate(proj, { role, language: langCode(specLang) });
  // El advisor va DESPUÉS del portón, y no es cosmético: importa `changed.mjs` de su árbol para que
  // "archivo cambiado" signifique lo mismo para el que mide y para el que decide (spec 008, R13).
  await emitNext(proj);
  // El buzón entre lados (spec 010). Se emite siempre; queda inerte hasta que `flow.sides` lo
  // encienda, cosa que solo hace `chalc feature` en modo worktree.
  await emitMail(proj);
  gateNotice(config);
  return skills;
}

export async function equipCreatedProject(proj, { targetName = 'claude', methodMode = 'lite', extraSkills = [], architecture = null } = {}) {
  targetName = assertSafeId(targetName, 'target');
  const ctx = await detectContext(proj);
  const rules = await loadJsonDir(RULES_DIR);
  const matched = matchRules(rules, ctx);
  const stacks = matched.filter((r) => !r.always);
  const skills = [...new Set([...matched.flatMap((r) => r.skills || []), ...extraSkills])];
  const mcpIds = [...new Set(matched.flatMap((r) => r.mcp || []))];
  const mcps = await Promise.all(mcpIds.map(async (id) => {
    const def = await loadMcp(id);
    return { id: def.id, description: def.description, server: deepSub(def.server, { PROJECT: proj }) };
  }));
  const sdd = (await loadMethods()).find((x) => x.id === 'sdd');
  const m = sdd && (sdd.modes.find((x) => x.id === methodMode) || sdd.modes[0]);
  const methods = m ? [{ id: sdd.id, label: sdd.label, mode: m.id, scaffoldDir: m.scaffoldDir, rulesText: m.rulesText }] : [];
  const targetFile = join(TARGETS_DIR, `${targetName}.mjs`);
  if (!existsSync(targetFile)) throw new Error(`Target no existe: ${targetName}`);
  const target = await import(pathToFileURL(targetFile).href);
  const applied = await target.apply({ projectPath: proj, CATALOG, skills, mcps, methods, stacks, architecture, dryRun: false });
  return { skills, mcps, methods, stacks, plan: applied.plan };
}
