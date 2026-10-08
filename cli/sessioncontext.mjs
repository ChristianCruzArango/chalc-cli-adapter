// cli/sessioncontext.mjs — las secciones de contexto del proyecto que viajan en el harness: stack y
// generadores, reglas del asistente, arquitectura, notas de carpetas y la conversación previa.

import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { projectTree } from './project.mjs';
import { frame } from './prompts/text.mjs';

// Cómo se GENERA código en cada stack: la instrucción concreta que evita que el modelo invente
// "tools de generación" MCP que no existen. Solo stacks con generador oficial de CLI.
const STACK_GENERATORS = {
  angular: 'ng generate <schematic> <nombre>',
  nestjs: 'nest generate <schematic> <nombre>',
  dotnet: 'dotnet new <plantilla>',
  flutter: 'flutter create <nombre>'
};

// Orientación mínima del proyecto (siempre incluida): lo detectado por inspectProject en pocas líneas.
function contextSection(project, language) {
  const f = frame(language);
  const lines = [f.ctxHeader];
  if (project.equipped) {
    if (project.stacks?.length) lines.push(`- ${f.ctxStacks}: ${project.stacks.join(', ')}`);
    const gen = (project.stacks || []).map((s) => STACK_GENERATORS[s]).filter(Boolean);
    if (gen.length) lines.push(f.ctxGenerate(gen.join(' · ')));
    if (project.detected.skills.length) lines.push(`- ${f.ctxSkills}: ${project.detected.skills.join(', ')}`);
    if (project.detected.mcpServers.length) lines.push(`- ${f.ctxMcp}: ${project.detected.mcpServers.join(', ')}`);
  }
  if (project.git?.isRepo) lines.push(f.ctxGit(project.git.branch, project.git.clean));
  return { key: 'contexto', text: lines.join('\n'), required: true };
}

// key: identificador estable (independiente del idioma); title: encabezado visible (inglés: va al modelo).
// maxChars acota archivos largos (un README de 30k no debe desplazar al resto del contexto).
export async function readSection(file, key, title, required, maxChars = Infinity) {
  if (!file) return null;
  try {
    let text = (await readFile(file, 'utf8')).trim();
    if (!text) return null;
    if (text.length > maxChars) text = text.slice(0, maxChars) + '\n[…truncated]';
    return { key, text: `### ${title}\n${text}`, required };
  } catch {
    return null;
  }
}

// README internos de carpetas (src/app/features/README.md, core, shared…): documentan la convención
// EXACTAMENTE donde vive, y deben llegar al contexto aunque al modelo no se le ocurra explorarlos.
// Recolección determinista y acotada (hasta 8 archivos, cap por archivo); el de la raíz va aparte.
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', 'out', 'build', 'target', 'vendor']);
const MAX_FOLDER_NOTES = 8;
async function folderNotesSection(projectPath, title) {
  const found = [];
  async function walk(dir, depth) {
    if (depth > 4 || found.length >= MAX_FOLDER_NOTES) return;
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (found.length >= MAX_FOLDER_NOTES) return;
      if (e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) await walk(join(dir, e.name), depth + 1);
      else if (e.isFile() && e.name === 'README.md' && depth > 0) found.push(join(dir, e.name));
    }
  }
  await walk(projectPath, 0);
  const parts = [];
  for (const file of found) {
    try {
      let text = (await readFile(file, 'utf8')).trim();
      if (!text) continue;
      if (text.length > 1500) text = text.slice(0, 1500) + '\n[…truncated]';
      parts.push(`#### ${relative(projectPath, file).replace(/\\/g, '/')}\n${text}`);
    } catch { /* ilegible: se omite */ }
  }
  if (!parts.length) return null;
  return { key: 'folder-notes', required: false, text: `### ${title}\n${parts.join('\n\n')}` };
}

// Secciones de proyecto para el harness, con la PRIORIDAD que pidió el usuario: primero los documentos
// RECTORES que el propio proyecto mantiene (instrucciones CLAUDE.md/equivalente + constitución +
// arquitectura + README de carpetas) — son el mapa; las skills se cargan aparte y SELECTIVAS (por
// relevancia a la tarea), no por volumen. El budgeter decide qué opcionales caben.
export async function buildProjectSections(project, language) {
  const f = frame(language);
  const sections = [contextSection(project, language)];
  // Árbol REAL del proyecto (requerido): sin él, los modelos locales adivinan rutas que no existen.
  const tree = await projectTree(project.projectPath);
  if (tree) sections.push({ key: 'tree', required: true, text: `### project tree (the REAL files — do not guess paths)\n${tree}` });
  // Instrucciones del proyecto (CLAUDE.md / copilot-instructions.md / GEMINI.md según target): el
  // documento rector que el usuario mantiene para SUS agentes — obligatorio, no opcional.
  if (project.equipped && project.paths.rulesFile) {
    const rules = await readSection(project.paths.rulesFile, 'instrucciones', f.rulesTitle, true, 3000);
    if (rules) sections.push(rules);
  }
  // README: la orientación que el propio proyecto trae — se lee SIEMPRE que exista (equipado o no).
  const readme = await readSection(join(project.projectPath, 'README.md'), 'readme', f.readmeTitle, false, 2500);
  if (readme) sections.push(readme);
  if (project.equipped) {
    for (const s of [
      await readSection(project.paths.constitution, 'constitución', f.constitutionTitle, true),
      await readSection(project.paths.architecture, 'arquitectura', f.architectureTitle, false)
    ]) if (s) sections.push(s);
  }
  const notes = await folderNotesSection(project.projectPath, f.folderNotesTitle);
  if (notes) sections.push(notes);
  return sections;
}

// Conversación previa (resúmenes user↔agente) como sección OPCIONAL del harness. Lleva CONTEXTO entre turnos
// sin arrastrar cada observación: para modelos locales, resumir es lo que evita llenar la ventana. Se acota a
// los últimos turnos y el budgeter decide si cabe. Devuelve null si aún no hay conversación.
export function conversationSection(conversation, { max = 6, language } = {}) {
  const recent = conversation.slice(-max);
  if (!recent.length) return null;
  const f = frame(language);
  const text = recent.map((m) => `${m.role === 'user' ? f.roleUser : f.roleAgent}: ${m.content}`).join('\n');
  return { key: 'conversación', text: `${f.convHeader}\n${text}`, required: false };
}
