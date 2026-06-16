// lib/targetkit.mjs — utilidades compartidas por los targets (Copilot, Gemini, Cursor…).

import { copyFile, cp, mkdir, readFile, writeFile, readdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { assertSafeId } from './ids.mjs';

export const START = '<!-- chalc:start -->';
export const END = '<!-- chalc:end -->';

// Lee name + description del frontmatter de un SKILL.md del catálogo.
export async function readSkillMeta(CATALOG, id) {
  id = assertSafeId(id, 'skill id');
  const f = join(CATALOG, 'skills', id, 'SKILL.md');
  let name = id, description = '';
  if (existsSync(f)) {
    const fm = (await readFile(f, 'utf8')).match(/^---\n([\s\S]*?)\n---/);
    if (fm) {
      const n = fm[1].match(/^name:\s*(.+)$/m); if (n) name = n[1].trim();
      const d = fm[1].match(/^description:\s*(.+)$/m); if (d) description = d[1].trim();
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
