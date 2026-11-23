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
import { emitLive } from '../liveemit.mjs';
import { emitTeam } from '../teamemit.mjs';
import { emitDesign } from '../designemit.mjs';
import { emitProbe } from '../probeemit.mjs';
import { emitEvals } from '../evalsemit.mjs';
import { emitRoles } from '../rolesemit.mjs';
import { emitTeamConfig } from '../teamconfig.mjs';
import { emitIntegrity } from '../integrityemit.mjs';
import { emitGitHooks } from '../githooks.mjs';
import { emitCi } from '../ciemit.mjs';
import { ensureIgnored, ensureLocalIgnores } from '../gitignore-local.mjs';
import { loadToolTable, resolveStack, resolveTools } from '../tooltable.mjs';
import { loadRoles } from '../roles.mjs';
import { RETIRED_TARGETS } from '../targetfiles.mjs';
import { readChoices } from '../manifest.mjs';
import { skillDir } from '../userstore.mjs';

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

// Qué pasó con los hooks de git. Instalados o ya en su sitio no hace falta decir nada más que eso; lo que el
// usuario necesita saber es cuándo NO quedaron activos y qué hacer.
const HOOK_NOTICE = { installed: 'gitHooksInstalled', 'kept-other': 'gitHooksKeptOther', 'no-git': 'gitHooksNoGit', 'not-root': 'gitHooksNotRoot' };

function hooksNotice({ status, other }) {
  if (!HOOK_NOTICE[status]) return;
  const paint = status === 'installed' ? c.dim : c.yellow;
  console.log(paint('  ' + t(HOOK_NOTICE[status], other)));
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

// Las skills que el proyecto ya tenía y las reglas no aportan (spec 026, R5-R8): las extra de la
// arquitectura o las instaladas a mano. Se conservan las que siguen en el catálogo; las que ya no existen
// se devuelven aparte para avisar, porque equipar una carpeta inexistente rompería el equipado entero.
export function rememberedSkills(remembered, ruleSkills) {
  const inCatalog = (id) => existsSync(skillDir(CATALOG, id));
  return {
    skills: [...new Set([...ruleSkills, ...remembered.filter(inCatalog)])],
    missing: remembered.filter((id) => !inCatalog(id))
  };
}

/** Une a `ruleSkills` las recordadas en el manifiesto de `proj` y avisa de las que ya no existen. */
export function keepRememberedSkills(choices, ruleSkills) {
  const { skills, missing } = rememberedSkills(choices.skills, ruleSkills);
  for (const id of missing) console.warn(`  ! ${t('kitSkillGone', id)}`);
  return skills;
}

// El método SDD en el modo pedido (o el primero), en el idioma dado.
async function sddMethods(mode, language) {
  const sdd = (await loadMethods(language)).find((x) => x.id === 'sdd');
  const m = sdd && (sdd.modes.find((x) => x.id === mode) || sdd.modes[0]);
  return m ? [{ id: sdd.id, label: sdd.label, mode: m.id, scaffoldDir: m.scaffoldDir, rulesText: m.rulesText }] : [];
}

// Por qué no se puede usar un target: retirado (con su reemplazo, spec 021 R2), inexistente, o '' si se puede.
// Un solo sitio para el mensaje: lo usan el CLI (apply) y quien carga el módulo.
export function targetProblem(targetName) {
  if (RETIRED_TARGETS[targetName]) return t('targetRetired', targetName, RETIRED_TARGETS[targetName]);
  return existsSync(join(TARGETS_DIR, `${assertSafeId(targetName, 'target')}.mjs`)) ? '' : t('targetMissing', targetName);
}

// El módulo del target. `fallback`: si no existe, Claude Code; sin él, un target inexistente es error. Un target
// RETIRADO es error siempre: caer a otro en silencio sería engañar.
export async function loadTargetModule(targetName, { fallback = false } = {}) {
  const problem = targetProblem(targetName);
  if (!problem) return import(pathToFileURL(join(TARGETS_DIR, `${targetName}.mjs`)).href);
  if (!fallback || RETIRED_TARGETS[targetName]) throw new Error(problem);
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
  if (!dryRun) await emitRepoTools(proj, { ...emit, ctx, skills: equipment.skills || [], specLang: equipment.specLang || '' });
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
  const { stacks, skills: ruleSkills, mcpIds } = await matchedEquipment(ctx);
  // Lo que el proyecto ya eligió (spec 026, R4-R5): sin esto, generar una spec borraba la arquitectura
  // acordada en `chalc init` y las skills que no salen de las reglas.
  const choices = await readChoices(proj);
  const skills = keepRememberedSkills(choices, ruleSkills);
  const target = await loadTargetModule(targetName, { fallback: true });
  await applyEquipment(proj, target, {
    targetName, ctx, skills, stacks, specLang, architecture: choices.architecture,
    mcps: await resolveMcps(mcpIds),
    methods: await sddMethods(mode, langCode(specLang)),
    emit: { role, language: langCode(specLang) }
  });
  return skills;
}

// Lo que todo repo equipado lleva en `.chalc/`: portón, advisor y buzón. Va en un solo punto porque
// el target ya deja `.chalc/gate-hook.md` y la skill `mutation-testing` manda cerrar con el portón:
// un comando que equipe sin pasar por aquí deja documentado un `gate.mjs` que no existe.
export async function emitRepoTools(proj, { role = '', language = '', ctx = null, ci = false, structure = null, skills = [], specLang = '' } = {}) {
  const gate = await emitGate(proj, { role, language, structure });
  const { config, addedRoles } = gate;
  // El advisor va DESPUÉS del portón, y no es cosmético: importa `changed.mjs` de su árbol para que
  // "archivo cambiado" signifique lo mismo para el que mide y para el que decide (spec 008, R13).
  const next = await emitNext(proj);
  // El buzón entre lados (spec 010). Se emite siempre; queda inerte hasta que `flow.sides` lo
  // encienda, cosa que solo hace `chalc feature` en modo worktree.
  const mail = await emitMail(proj);
  // La memoria del proyecto (spec 015). Va con el advisor porque él la lee para entregar a cada tarea
  // lo que el proyecto ya aprendió.
  const memory = await emitMemory(proj);
  // El tablero en vivo (spec 020). Va el último: muestra lo que leen el portón, el advisor y la memoria.
  const live = await emitLive(proj);
  // La huella de todo lo emitido (spec 029, R7): el portón se niega a medir con herramientas alteradas.
  // El orquestador del equipo (spec 032): el registro de lo que hace cada rol y el estado que ve el usuario.
  const team = await emitTeam(proj);
  // Las instrucciones neutras de cada rol y la configuración del equipo (spec 034): con qué corre cada uno.
  const roles = await emitRoles(proj, { skills, specLang: specLang || config.language });
  await emitTeamConfig(proj, { skills });
  // El contrato de diseño y su evaluador (spec 038): lo que una interfaz tiene que cumplir, con números.
  const design = await emitDesign(proj);
  // Las sondas de API y CLI (spec 041): lo que una spec sin interfaz tiene que contestar, levantada.
  const probe = await emitProbe(proj);
  // Los evals activos (spec 042): casos con trampa para comparar roles, instrucciones o modelos.
  const evals = await emitEvals(proj);
  // Los hooks de git (spec 029, R1): corren con cualquier asistente, y cuando commitea una persona.
  const hooks = await emitGitHooks(proj);
  await emitIntegrity(proj, [gate, next, mail, memory, live, team, roles, design, probe, evals, hooks].flatMap((emitted) => emitted.written));
  // Lo que todo eso escribe en `.chalc/` y es de esta máquina, fuera de git también en repos que ya existían.
  await ensureLocalIgnores(proj);
  // Y los temporales de la herramienta de mutación del stack (spec 027, R9): gigas que no son fuente.
  const { tools } = await repoTools(proj, ctx || await detectContext(proj));
  if (tools?.equip.ignore.length) await ensureIgnored(proj, tools.equip.ignore, t('gitignoreMutationHeader'));
  // El workflow de CI, solo si se pidió (spec 029, R10): se ejecuta solo y va commiteado.
  if (ci) await emitCi(proj);
  gateNotice(config, addedRoles);
  hooksNotice(hooks);
  return config;
}

// specLang: idioma del contenido (`chalc init --lang`, R36); vacío = el de la interfaz, como antes.
// opts.structure: las carpetas de la arquitectura recién creada (spec 031, R1); el portón exige que el código nuevo nazca ahí.
export async function equipCreatedProject(proj, { targetName = 'claude', methodMode = 'lite', extraSkills = [], architecture = null, specLang = '', ci = false, structure = null } = {}) {
  const ctx = await detectContext(proj);
  const found = await matchedEquipment(ctx);
  const skills = [...new Set([...found.skills, ...extraSkills])];
  const mcps = await resolveMcps(found.mcpIds);
  const methods = await sddMethods(methodMode, langCode(specLang));
  const target = await loadTargetModule(targetName);
  const applied = await applyEquipment(proj, target, {
    targetName, ctx, skills, mcps, methods, stacks: found.stacks, architecture, specLang, emit: { language: langCode(specLang), ci, structure }
  });
  return { skills, mcps, methods, stacks: found.stacks, plan: applied.plan };
}
