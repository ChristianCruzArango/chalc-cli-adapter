// lib/targetkit.mjs — utilidades compartidas por los targets (Copilot, Gemini, Cursor…).

import { copyFile, cp, mkdir, readFile, writeFile, readdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { assertSafeId } from './ids.mjs';
import { lang } from './i18n.mjs';

export const START = '<!-- chalc:start -->';
export const END = '<!-- chalc:end -->';

// Skills globales que SIEMPRE deben aplicarse (regla global.json). Si vienen equipadas, el bloque del
// asistente abre con un mandato prominente: que no queden como un bullet más entre 18 skills.
const MANDATORY_SKILLS = ['clean-code', 'minimal-implementation', 'solid-principles', 'modular-architecture'];

// Referencia a docs/architecture.md en el archivo del asistente: lo apunta a leer la arquitectura
// acordada ANTES de crear/mover archivos. Devuelve null si el doc no existe (no inventa la referencia).
export function architectureBlock(projectPath, name = '') {
  if (!existsSync(join(projectPath, 'docs', 'architecture.md'))) return null;
  const named = name ? (lang === 'en' ? `Agreed architecture: **${name}**.\n` : `Arquitectura acordada: **${name}**.\n`) : '';
  return lang === 'en'
    ? `### 🏛️ Architecture\n${named}Before creating or moving ANY file, read \`docs/architecture.md\` — it defines the layers, what goes in each folder, the dependency rules and how to add a feature. Each folder also has its own \`README.md\` with its role. Keep all code within those boundaries.`
    : `### 🏛️ Arquitectura\n${named}Antes de crear o mover CUALQUIER archivo, lee \`docs/architecture.md\` — define las capas, qué va en cada carpeta, las reglas de dependencia y cómo agregar un feature. Cada carpeta tiene además su propio \`README.md\` con su rol. Mantén todo el código dentro de esos límites.`;
}

// Bloque de "Principios obligatorios (siempre)" para el archivo del asistente. Devuelve null si el
// proyecto no trae las skills globales (no inventa el mandato donde no corresponde). Bilingüe.
export function mandatoryPrinciplesBlock(skills = []) {
  if (MANDATORY_SKILLS.filter((s) => skills.includes(s)).length < 2) return null;
  return lang === 'en'
    ? [
        '### ✅ Mandatory principles (ALWAYS)',
        'Minimal implementation, Clean Code, SOLID and **modular architecture** apply to **all** code in this project — no exceptions:',
        'high cohesion and low coupling, small units, explicit names, one responsibility per file/folder/symbol,',
        'code that is testable by design, and the smallest change that satisfies the current approved requirement',
        'or failing test. Reuse existing code and framework APIs before adding files, wrappers, abstractions,',
        'dependencies, tooling or layers. The `minimal-implementation`, `clean-code`, `solid-principles` and',
        '`modular-architecture` skills define the detail — **open and apply them by default**, not only when explicitly asked.'
      ].join('\n')
    : [
        '### ✅ Principios obligatorios (SIEMPRE)',
        'Implementación mínima, Clean Code, SOLID y **arquitectura modular** aplican a **todo** el código de este proyecto, sin excepción:',
        'alta cohesión y bajo acoplamiento, unidades pequeñas, nombres explícitos, una responsabilidad por',
        'archivo/carpeta/símbolo, código testeable desde el diseño y el cambio más pequeño que satisface el',
        'requisito aprobado o test fallando actual. Reutiliza código existente y APIs del framework antes de crear',
        'archivos, wrappers, abstracciones, dependencias, tooling o capas. Las skills `minimal-implementation`,',
        '`clean-code`, `solid-principles` y `modular-architecture` definen el detalle — **ábrelas y aplícalas por defecto**, no solo cuando se pidan.'
      ].join('\n');
}

// Lee name + description del frontmatter de un SKILL.md del catálogo.
export async function readSkillMeta(CATALOG, id) {
  id = assertSafeId(id, 'skill id');
  const f = join(CATALOG, 'skills', id, 'SKILL.md');
  let name = id, description = '';
  if (existsSync(f)) {
    const fm = (await readFile(f, 'utf8')).match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (fm) {
      const n = fm[1].match(/^name:\s*([^\r\n]+)/m); if (n) name = n[1].trim();
      const d = fm[1].match(/^description:\s*([^\r\n]+)/m); if (d) description = d[1].trim();
    }
  }
  return { id, name, description };
}

// Copia los skills (contenido real) a una carpeta neutra del proyecto.
export async function copySkills(CATALOG, skills, destDir) {
  if (!skills.length) return;
  await mkdir(destDir, { recursive: true });
  for (const skill of skills) {
    const s = assertSafeId(skill, 'skill id');
    await cp(join(CATALOG, 'skills', s), join(destDir, s), { recursive: true, dereference: true });
  }
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

export async function writeManagedBlock(file, block) {
  await mkdir(dirname(file), { recursive: true });
  let content = existsSync(file) ? await readFile(file, 'utf8') : '';
  if (content.includes(START) && content.includes(END)) {
    content = content.replace(new RegExp(`${START}[\\s\\S]*?${END}`), block);
  } else {
    content = content.trimEnd() + (content ? '\n\n' : '') + block + '\n';
  }
  await writeFile(file, content.endsWith('\n') ? content : content + '\n');
}

// Fusiona JSON existente (no pisa otras claves).
export async function mergeJson(file, mutate) {
  await mkdir(dirname(file), { recursive: true });
  let json = {};
  if (existsSync(file)) {
    try {
      json = JSON.parse(await readFile(file, 'utf8'));
    } catch (e) {
      const backup = `${file}.invalid-${Date.now()}`;
      await copyFile(file, backup);
      console.warn(`  ! JSON inválido en ${file}; respaldo creado: ${backup}`);
    }
  }
  mutate(json);
  await writeFile(file, JSON.stringify(json, null, 2) + '\n');
}

export async function writeManifest(projectPath, target, stacks, skills, mcps, methods) {
  await writeFile(join(projectPath, '.chalc.json'), JSON.stringify({
    target: assertSafeId(target, 'target'),
    stacks: stacks.map((s) => assertSafeId(s.id, 'stack id')),
    skills: skills.map((s) => assertSafeId(s, 'skill id')),
    mcp: mcps.map((m) => assertSafeId(m.id, 'MCP id')),
    methods: methods.map((m) => {
      const id = assertSafeId(m.id, 'method id');
      const mode = m.mode && m.mode !== 'default' ? assertSafeId(m.mode, 'method mode id') : '';
      return mode ? `${id}:${mode}` : id;
    }),
    generatedAt: new Date().toISOString()
  }, null, 2) + '\n');
}

// Cabecera de perfil (lenguaje/stack/convención) como líneas markdown.
// El perfil (Lenguaje/Stack/Convención) se omite a propósito: el asistente ya ve el
// proyecto y ese bloque solo llenaba contexto. Las skills/MCP/métodos son lo único útil.
export function profileLines() {
  return [];
}

// Borra archivos con prefijo gestionado de una carpeta (para no dejar reglas obsoletas).
export async function cleanPrefixed(dir, prefix, ext) {
  if (!existsSync(dir)) return;
  for (const f of await readdir(dir)) {
    if (f.startsWith(prefix) && f.endsWith(ext)) await unlink(join(dir, f)).catch(() => {});
  }
}

// Construye un archivo .mdc (Cursor) con frontmatter.
export function mdc({ description = '', globs = '', alwaysApply = false, body = '' }) {
  const fm = ['---', `description: ${description}`];
  if (globs) fm.push(`globs: ${globs}`);
  fm.push(`alwaysApply: ${alwaysApply}`, '---');
  return fm.join('\n') + '\n\n' + body.trim() + '\n';
}
