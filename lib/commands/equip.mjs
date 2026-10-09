// Equipamiento de proyectos: scaffold SDD y proyección de skills/MCP/métodos vía el target.
// Lo reutilizan apply, spec, spec-ia, feature e init.

import { cp, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { lang, t } from '../i18n.mjs';
import { assertSafeId } from '../ids.mjs';
import { detectContext, matchRules } from '../detect.mjs';
import { CATALOG, METHODS_DIR, TARGETS_DIR, c, force } from './context.mjs';
import { deepSub, langCode, loadMcp, loadMethods, loadRules } from './catalogstore.mjs';
import { emitGate } from '../gateemit.mjs';
import { emitNext } from '../nextemit.mjs';
import { emitMail } from '../mailemit.mjs';
import { emitMemory } from '../memoryemit.mjs';
import { loadToolTable, resolveStack, resolveTools } from '../tooltable.mjs';
import { loadRoles } from '../roles.mjs';

// Aviso por consola de que el repo ya tiene portón. Si la detección no supo resolver algo (un stack
// sin herramienta estándar, un `test` que no corre nada), se dice AQUÍ y no al primer bloqueo: el
// usuario acaba de equipar y es cuando puede arreglarlo en un minuto.
function gateNotice(config, addedRoles = []) {
  console.log(c.dim('  ' + t('gateReady')));
  if (config.pending?.length) console.log(c.yellow('  ' + t('gatePending', config.pending.join(', '))));
  if (addedRoles.length) console.log(c.yellow('  ' + t('gateRolesAdded', addedRoles.join(', '))));
}

// El stack del repo y lo que la tabla de herramientas resolvió para él (spec 011, R9): con eso la skill
// `mutation-testing` llega aterrizada en ESTE repo en vez de con la tabla de nueve lenguajes. Un solo
// sitio para los tres flujos de equipamiento: estaba copiado y `apply` lo había olvidado (F-25).
export async function repoTools(proj, ctx) {
  const table = await loadToolTable();
  const toolStack = resolveStack(table, ctx);
  return { stacks: table, stack: toolStack, tools: toolStack ? await resolveTools(toolStack, proj, ctx) : null };
}

// Targets que conceden permisos POR AGENTE. En los demás, el alcance de un rol es una instrucción
// que nada impide saltarse (spec 009, R5), y el usuario merece saber cuál de las dos cosas compró.
const ENFORCES_SCOPE = new Set(['claude']);

export function rolesNotice(roles, targetName) {
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
  if (!existsSync(scaffoldDir)) throw new Error(t('sddScaffoldMissing', scaffoldName));
  await cp(scaffoldDir, projectPath, { recursive: true, force: false, errorOnExist: false, dereference: true });
  await mkdir(specsDir, { recursive: true });
  return specsDir;
}

// `${PROJECT}` como ruta RELATIVA: el MCP arranca en la raíz del proyecto, y una ruta absoluta
// dejaba en el repo el nombre de usuario de esta máquina y no funcionaba en ninguna otra.
export function resolveMcps(mcpIds) {
  return Promise.all(mcpIds.map(async (id) => {
    const def = await loadMcp(id);
    return { id: def.id, description: def.description, server: deepSub(def.server, { PROJECT: '.' }) };
  }));
}

// Lo que las reglas que casan con el repo equipan: stacks (sin la global), skills y MCP obligatorios
// (los opcionales llevan secretos y solo se añaden preguntando, en `apply`).
async function matchedEquipment(ctx) {
  const matched = matchRules(await loadRules(), ctx);
  return {
    stacks: matched.filter((r) => !r.always),
    skills: [...new Set(matched.flatMap((r) => r.skills || []))],
    mcpIds: [...new Set(matched.flatMap((r) => r.mcp || []))]
  };
}

// El método SDD en el modo pedido (o el primero), en el idioma dado.
async function sddMethods(mode, language) {
  const sdd = (await loadMethods(language)).find((x) => x.id === 'sdd');
  const m = sdd && (sdd.modes.find((x) => x.id === mode) || sdd.modes[0]);
  return m ? [{ id: sdd.id, label: sdd.label, mode: m.id, scaffoldDir: m.scaffoldDir, rulesText: m.rulesText }] : [];
}

// El módulo del target. `fallback`: si no existe, Claude Code; sin él, un target inexistente es error.
export async function loadTargetModule(targetName, { fallback = false } = {}) {
  const targetFile = join(TARGETS_DIR, `${assertSafeId(targetName, 'target')}.mjs`);
  if (existsSync(targetFile)) return import(pathToFileURL(targetFile).href);
  if (!fallback) throw new Error(t('targetMissing', targetName));
  return import(pathToFileURL(join(TARGETS_DIR, 'claude.mjs')).href);
}

// El último paso común a todo equipamiento: el target proyecta skills, MCP, métodos y roles, y el
// repo recibe sus herramientas (portón, advisor, buzón, memoria). Los roles de revisión salen de sus
// contratos (spec 009, R2) y son los mismos que `emitRepoTools` declara en gate.json: si el target no
// los instalara, el advisor pediría un rol que el asistente no tiene. En dry-run solo se planifica.
export async function applyEquipment(proj, target, { targetName, ctx, emit = {}, dryRun = false, ...equipment }) {
  const roles = await loadRoles();
  if (!dryRun) rolesNotice(roles, targetName);
  const applied = await target.apply({ projectPath: proj, CATALOG, ...equipment, roles, dryRun, force, tools: await repoTools(proj, ctx) });
  if (!dryRun) await emitRepoTools(proj, emit);
  return applied;
}

// Equipa el proyecto para spec-ia: skills (incl. mutation-testing global) + MCP + método SDD + el
// portón de calidad, vía el target. Devuelve la lista de skills equipadas (para el hand-off).
//
// El portón se emite AQUÍ y no en un comando propio porque este es el punto por el que pasan los
// tres consumidores: `spec-ia` con un repo, `feature` con back/front/móvil, y `feature` en modo
// worktree con la ruta de cada worktree. Emitir aquí los cubre a los tres —y cumple R15 por
// construcción: si `proj` es el worktree, el repo principal no se toca.
// El método y los roles van en el idioma del SPEC, no el del CLI; y el portón también: vive en el
// repo del usuario, no en la consola de chalc.
// opts: { specLang, role } — idioma del spec y rol del lado (back/front/movil) en un workspace.
export async function equipForSpec(proj, mode, targetName, { specLang = '', role = '' } = {}) {
  const ctx = await detectContext(proj);
  const { stacks, skills, mcpIds } = await matchedEquipment(ctx);
  const target = await loadTargetModule(targetName, { fallback: true });
  await applyEquipment(proj, target, {
    targetName, ctx, skills, stacks, specLang,
    mcps: await resolveMcps(mcpIds),
    methods: await sddMethods(mode, langCode(specLang)),
    emit: { role, language: langCode(specLang) }
  });
  return skills;
}

// Lo que todo repo equipado lleva en `.chalc/`: portón, advisor y buzón. Va en un solo punto porque
// el target ya deja `.chalc/gate-hook.md` y la skill `mutation-testing` manda cerrar con el portón:
// un comando que equipe sin pasar por aquí deja documentado un `gate.mjs` que no existe.
export async function emitRepoTools(proj, { role = '', language = '' } = {}) {
  const { config, addedRoles } = await emitGate(proj, { role, language });
  // El advisor va DESPUÉS del portón, y no es cosmético: importa `changed.mjs` de su árbol para que
  // "archivo cambiado" signifique lo mismo para el que mide y para el que decide (spec 008, R13).
  await emitNext(proj);
  // El buzón entre lados (spec 010). Se emite siempre; queda inerte hasta que `flow.sides` lo
  // encienda, cosa que solo hace `chalc feature` en modo worktree.
  await emitMail(proj);
  // La memoria del proyecto (spec 015). Va con el advisor porque él la lee para entregar a cada tarea
  // lo que el proyecto ya aprendió.
  await emitMemory(proj);
  gateNotice(config, addedRoles);
  return config;
}

// specLang: idioma del contenido (`chalc init --lang`, R36); vacío = el de la interfaz, como antes.
export async function equipCreatedProject(proj, { targetName = 'claude', methodMode = 'lite', extraSkills = [], architecture = null, specLang = '' } = {}) {
  const ctx = await detectContext(proj);
  const found = await matchedEquipment(ctx);
  const skills = [...new Set([...found.skills, ...extraSkills])];
  const mcps = await resolveMcps(found.mcpIds);
  const methods = await sddMethods(methodMode, langCode(specLang));
  const target = await loadTargetModule(targetName);
  const applied = await applyEquipment(proj, target, {
    targetName, ctx, skills, mcps, methods, stacks: found.stacks, architecture, specLang, emit: { language: langCode(specLang) }
  });
  return { skills, mcps, methods, stacks: found.stacks, plan: applied.plan };
}
