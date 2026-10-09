// lib/targetkit.mjs — utilidades compartidas por los targets (Copilot, Gemini, Cursor…).

import { cp, mkdir, readFile, writeFile, readdir, unlink, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { assertSafeId } from './ids.mjs';
import { t } from './i18n.mjs';
import { renderMutationSkill } from './toolskill.mjs';
import { readJsonOrKeep, backupBeforeReplace } from './userdata.mjs';
import { skillDir } from './userstore.mjs';
import { hashDir } from './install.mjs';
import { START, END, MANAGED_MARK, yamlValue } from './targetkit/formats.mjs';
import { roleLines } from './targetkit/roles.mjs';
import { blockText } from './targetkit/blocktext.mjs';
export { blockText } from './targetkit/blocktext.mjs';
export { START, END, TOML_START, TOML_END, MANAGED_MARK, writeManagedBlock, tomlMcpServers, yamlScalar, mdc } from './targetkit/formats.mjs';
export { roleText, roleLines, writeRole, writeGateHookDoc } from './targetkit/roles.mjs';
export { planLabel, planNote, methodPlanLine } from './targetkit/plan.mjs';

// Skills globales que SIEMPRE deben aplicarse (regla global.json). Si vienen equipadas, el bloque del
// asistente abre con un mandato prominente: que no queden como un bullet más entre 18 skills.
export const MANDATORY_SKILLS = ['clean-code', 'minimal-implementation', 'solid-principles', 'modular-architecture'];

// Referencia a docs/architecture.md en el archivo del asistente: lo apunta a leer la arquitectura
// acordada ANTES de crear/mover archivos. Devuelve null si el doc no existe (no inventa la referencia).
export function architectureBlock(projectPath, name = '', specLang = '') {
  if (!existsSync(join(projectPath, 'docs', 'architecture.md'))) return null;
  const tx = blockText(specLang);
  return tx.architecture + (name ? tx.agreedArchitecture(name) : '') + tx.architectureBody;
}

// Bloque de "Principios obligatorios (siempre)" para el archivo del asistente. Devuelve null si el
// proyecto no trae las skills globales (no inventa el mandato donde no corresponde). Bilingüe.
export function mandatoryPrinciplesBlock(skills = [], specLang = '') {
  if (MANDATORY_SKILLS.filter((s) => skills.includes(s)).length < 2) return null;
  return blockText(specLang).principles.join('\n');
}

// Lee name + description del frontmatter de un SKILL.md del catálogo.
export async function readSkillMeta(CATALOG, id) {
  id = assertSafeId(id, 'skill id');
  const f = join(skillDir(CATALOG, id), 'SKILL.md');
  let name = id, description = '';
  if (existsSync(f)) {
    const fm = (await readFile(f, 'utf8')).match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (fm) {
      const n = fm[1].match(/^name:\s*([^\r\n]+)/m); if (n) name = yamlValue(n[1]);
      const d = fm[1].match(/^description:\s*([^\r\n]+)/m); if (d) description = yamlValue(d[1]);
    }
  }
  return { id, name, description };
}

// Copia los skills (contenido real) a una carpeta neutra del proyecto.
//
// `tools` (spec 011, R9) trae el stack del repo y lo que la tabla resolvió para él. Con eso, la
// skill `mutation-testing` llega ATERRIZADA —su comando, su reporte, su instalación— en vez de con
// una tabla de nueve lenguajes de los que ocho no aplican. Sin `tools`, se copia tal cual: las demás
// skills no llevan marcadores y no deben tocarse.
// Lo que se va a copiar al proyecto ¿es lo que quedó bloqueado? El hash esperado sale del manifiesto
// de la skill (instaladas) o de `skills-lock.json` (las del catálogo sin manifiesto). Si no coincide,
// alguien cambió la skill después de instalarla: se avisa, no se bloquea —el mantenedor puede estar
// editándola—, y el test de sincronía del lock obliga a registrarlo antes de publicar.
async function verifySkill(CATALOG, id) {
  const src = skillDir(CATALOG, id);
  let expected = '';
  try { expected = JSON.parse(await readFile(join(src, '.chalc-skill.json'), 'utf8')).contentSha256 || ''; } catch {
    try { expected = JSON.parse(await readFile(join(dirname(CATALOG), 'skills-lock.json'), 'utf8')).builtins?.[id]?.contentSha256 || ''; } catch { /* sin lock */ }
  }
  if (expected && expected !== await hashDir(src)) {
    console.warn(`  ! ${t('kitSkillHashMismatch', id)}`);
  }
}

// Marca de lo que chalc genera. Lo que la lleva es de chalc y se reemplaza al equipar; lo que no,
// puede ser del usuario y se respalda antes de tocarlo.
const SKILL_MARK_FILE = '.chalc-managed';

// Copia cada skill del catálogo LIMPIA (sin mezclar con lo que hubiera). Una carpeta homónima que no
// lleva la marca de chalc es del usuario: se respalda en `.chalc/backups/` antes de reemplazarla.
export async function copySkills(CATALOG, skills, destDir, { tools = null, projectPath = dirname(dirname(destDir)) } = {}) {
  if (!skills.length) return;
  await mkdir(destDir, { recursive: true });
  for (const skill of skills) {
    const s = assertSafeId(skill, 'skill id');
    const dest = join(destDir, s);
    if (existsSync(dest)) {
      if (!existsSync(join(dest, SKILL_MARK_FILE))) await backupBeforeReplace(projectPath, dest, 'notOursSkill');
      await rm(dest, { recursive: true, force: true });
    }
    await verifySkill(CATALOG, s);
    await cp(skillDir(CATALOG, s), dest, { recursive: true, dereference: true });
    await renderSkillInPlace(dest, tools);
    await writeFile(join(dest, SKILL_MARK_FILE), `${MANAGED_MARK} — la genera chalc al equipar; los cambios aquí se reemplazan.\n`);
  }
}

// Una skill puede traer `SKILL.template.md`: entonces su `SKILL.md` se DERIVA de la tabla de
// herramientas para el stack de este repo (spec 011, R9).
//
// La plantilla y el documento conviven a propósito. `SKILL.md` está commiteado ya renderizado —con
// la tabla completa y sin marcadores— porque el catálogo no es solo material de reparto: es también
// lo que se lee al desarrollar chalc, donde `mutation-testing` es una skill activa. Un archivo lleno
// de `{{MARCADORES}}` sería inservible ahí. Un test verifica que los dos no puedan divergir.
//
// La plantilla NO viaja al repo del usuario: allí solo confundiría.
async function renderSkillInPlace(skillDir, tools) {
  const template = join(skillDir, 'SKILL.template.md');
  if (!existsSync(template)) return;

  if (tools) await writeFile(join(skillDir, 'SKILL.md'), renderMutationSkill(await readFile(template, 'utf8'), tools), 'utf8');
  await unlink(template);
}

// Escribe/actualiza un bloque gestionado en un archivo markdown sin tocar el resto.
// Copia el scaffold de cada método (p. ej. specs/ del SDD) al proyecto, sin sobrescribir lo del usuario.
// Es contenido del PROYECTO, no del asistente, así que TODOS los targets deben aplicarlo (Claude, Copilot, …).
export async function copyMethodScaffolds(methods, projectPath) {
  for (const me of methods || []) {
    if (me.scaffoldDir && existsSync(me.scaffoldDir)) {
      await cp(me.scaffoldDir, projectPath, { recursive: true, force: false, errorOnExist: false, dereference: true });
    }
  }
}

// Fusiona JSON existente (no pisa otras claves). Uno ilegible se respalda (política de userdata.mjs).
export async function mergeJson(file, mutate) {
  await mkdir(dirname(file), { recursive: true });
  let json = await readJsonOrKeep(file, {});
  if (!json || typeof json !== 'object' || Array.isArray(json)) json = {};
  mutate(json);
  await writeFile(file, JSON.stringify(json, null, 2) + '\n');
}

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Añade los servidores MCP del catálogo a `file` (clave `key`) SIN pisar uno que el usuario ya
// configuró con el mismo id: ese conserva su env, sus tokens y sus rutas. Con `force` se reemplaza.
export async function mergeMcpServers(file, mcps, { key = 'mcpServers', force = false } = {}) {
  const kept = [];
  await mergeJson(file, (j) => {
    j[key] = j[key] || {};
    for (const m of mcps) {
      const current = j[key][m.id];
      if (current && !force && !sameJson(current, m.server)) { kept.push(m.id); continue; }
      j[key][m.id] = m.server;
    }
  });
  for (const id of kept) console.warn(`  ! ${t('kitMcpKept', file, id)}`);
  return kept;
}

// `generatedAt` solo cambia cuando cambia el CONTENIDO: reescribirlo en cada ejecución ensuciaba el diff
// del repo con un manifiesto que decía exactamente lo mismo.
// equipment: { stacks, skills, mcps, methods } — lo que se equipó.
export async function writeManifest(projectPath, target, equipment) {
  const file = join(projectPath, '.chalc.json');
  const body = manifestBody(target, equipment);
  const previous = await readJsonOrKeep(file, null);
  if (previous && JSON.stringify({ ...previous, generatedAt: undefined }) === JSON.stringify({ ...body, generatedAt: undefined })) return;
  await writeFile(file, JSON.stringify({ ...body, generatedAt: new Date().toISOString() }, null, 2) + '\n');
}

function manifestBody(target, { stacks, skills, mcps, methods }) {
  return {
    target: assertSafeId(target, 'target'),
    stacks: stacks.map((s) => assertSafeId(s.id, 'stack id')),
    skills: skills.map((s) => assertSafeId(s, 'skill id')),
    mcp: mcps.map((m) => assertSafeId(m.id, 'MCP id')),
    methods: methods.map((m) => {
      const id = assertSafeId(m.id, 'method id');
      const mode = m.mode && m.mode !== 'default' ? assertSafeId(m.mode, 'method mode id') : '';
      return mode ? `${id}:${mode}` : id;
    })
  };
}

// Cabecera de perfil (lenguaje/stack/convención) como líneas markdown.
// El perfil (Lenguaje/Stack/Convención) se omite a propósito: el asistente ya ve el
// proyecto y ese bloque solo llenaba contexto. Las skills/MCP/métodos son lo único útil.
export function profileLines() {
  return [];
}

// Borra archivos con prefijo gestionado de una carpeta (para no dejar reglas obsoletas).
// Retira las reglas que chalc dejó en una corrida anterior. Una con el prefijo pero SIN la marca de
// chalc puede ser del usuario (o de una versión antigua): se respalda antes de retirarla.
export async function cleanPrefixed(dir, prefix, ext, { projectPath = dirname(dirname(dir)) } = {}) {
  if (!existsSync(dir)) return;
  for (const f of await readdir(dir)) {
    if (!f.startsWith(prefix) || !f.endsWith(ext)) continue;
    const file = join(dir, f);
    const ours = (await readFile(file, 'utf8').catch(() => '')).includes(MANAGED_MARK);
    if (!ours) await backupBeforeReplace(projectPath, file, 'notOursRule');
    await unlink(file).catch(() => {});
  }
}

// --- Bloque gestionado de los targets markdown --------------------------------------------------
// Codex, Copilot y Gemini construyen EXACTAMENTE el mismo bloque; lo único que cambia entre ellos es
// en qué archivo aterriza y cómo escribe cada uno sus servidores MCP. La etapa de duplicación de la
// spec 012 lo señaló: diecisiete líneas idénticas entre los tres.
//
// Lo que queda en cada target es lo que de verdad lo distingue. Lo que se comparte es esto, que no
// es una decisión de ningún target sino del formato del bloque de chalc.

// Lo que todo bloque de chalc lleva igual, sea cual sea el target: delante, los principios
// obligatorios y la arquitectura acordada; detrás, los servidores MCP y las reglas de cada método.
// Entre medias cada target pone sus skills a su manera (Claude las carga solo; el resto, por ruta).
export function blockSections({ projectPath, skills = [], mcps = [], methods = [], architecture = null, specLang = '' }) {
  const head = [];
  const principles = mandatoryPrinciplesBlock(skills, specLang);
  if (principles) head.push('', principles);
  const archRef = architectureBlock(projectPath, architecture?.name, specLang);
  if (archRef) head.push('', archRef);
  const tail = [];
  if (mcps.length) tail.push('', `### ${blockText(specLang).mcpServers}`, ...mcps.map((m) => `- \`${m.id}\` — ${m.description || ''}`));
  for (const me of methods) tail.push('', me.rulesText.trim());
  return { head, tail };
}

export async function chalcBlock(CATALOG, {
  projectPath, skills = [], mcps = [], methods = [], roles = [], architecture = null, specLang = ''
} = {}) {
  const tx = blockText(specLang);
  const metas = await Promise.all(skills.map((s) => readSkillMeta(CATALOG, s)));
  const { head, tail } = blockSections({ projectPath, skills, mcps, methods, architecture, specLang });
  const lines = [START, '## ⚙️ Chalc', ...head];
  if (metas.length) {
    lines.push('', `### ${tx.skillsAvailable}`, tx.readWhenNeeded,
      ...metas.map((m) => `- **${m.name}** — ${m.description} → \`.chalc/skills/${m.id}/SKILL.md\``));
  }
  lines.push(...tail);
  // Los roles de revisión: aquí no hay subagentes, así que van como secciones del mismo bloque, con
  // el aviso de que su alcance es una instrucción y no una restricción (spec 009, R5).
  for (const role of roles) lines.push(...await roleLines(CATALOG, role, { skills, specLang }));
  lines.push(END);
  return lines.join('\n');
}
