// cli/project.mjs — ACOPLE al proyecto equipado por chalc.
// El ancla es .chalc.json en la raíz (lo escribe writeManifest en lib/targetkit.mjs). A partir del
// `target` se resuelven las rutas REALES donde vive lo equipado: skills, servidores MCP y reglas.
// El CLI lee lo que el proyecto YA tiene instalado; no recarga del catálogo global.

import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { gitStatus } from '../lib/gitprep.mjs';

// Dónde deja cada target su contenido. VERIFICADO contra targets/*.mjs (claude/cursor/copilot/gemini).
// skillsDir: carpeta con <id>/SKILL.md ; mcpFile: JSON con MCP ; mcpKey: clave del objeto de servidores
// (varía: "mcpServers" | "servers") ; rulesFile: doc de instrucciones del asistente, o null si el target
// no usa un archivo único (cursor dispersa reglas en .cursor/rules/*.mdc → se apoya en constitución/arquitectura).
// Nota: solo claude guarda skills en .claude/skills; el resto usa la carpeta neutra .chalc/skills.
const TARGET_LAYOUT = {
  claude:  { skillsDir: ['.claude', 'skills'], mcpFile: ['.mcp.json'],                mcpKey: 'mcpServers', rulesFile: ['CLAUDE.md'] },
  cursor:  { skillsDir: ['.chalc', 'skills'],  mcpFile: ['.cursor', 'mcp.json'],      mcpKey: 'mcpServers', rulesFile: null },
  copilot: { skillsDir: ['.chalc', 'skills'],  mcpFile: ['.vscode', 'mcp.json'],      mcpKey: 'servers',    rulesFile: ['.github', 'copilot-instructions.md'] },
  gemini:  { skillsDir: ['.chalc', 'skills'],  mcpFile: ['.gemini', 'settings.json'], mcpKey: 'mcpServers', rulesFile: ['GEMINI.md'] }
};

const CONSTITUTION = ['specs', 'constitution.md'];
const ARCHITECTURE = ['docs', 'architecture.md'];

// Lee y parsea el manifiesto. Devuelve null si el proyecto no está equipado (no hay .chalc.json).
export async function readManifest(projectPath) {
  const file = join(projectPath, '.chalc.json');
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    throw new Error(`.chalc.json existe pero es JSON inválido: ${file}`);
  }
}

// Resuelve el contexto del proyecto equipado. No lee el CONTENIDO de skills/MCP todavía (eso lo hacen
// skills/loader.mjs y mcp/*, bajo presupuesto de tokens); aquí solo se localiza QUÉ hay y DÓNDE.
// Devuelve { equipped:false } si no hay manifiesto, para que el CLI pueda arrancar igual en modo básico.
export async function loadProject(projectPath) {
  const manifest = await readManifest(projectPath);
  if (!manifest) return { equipped: false, projectPath };

  const target = manifest.target || 'claude';
  const layout = TARGET_LAYOUT[target] || TARGET_LAYOUT.claude;
  const at = (parts) => join(projectPath, ...parts);
  // resolveOptional: ruta absoluta si el target la define Y existe en disco; null si no. Acepta null (p. ej.
  // cursor no tiene un archivo de reglas único) sin construir una ruta inválida.
  const resolveOptional = (parts) => (parts && existsSync(at(parts)) ? at(parts) : null);

  return {
    equipped: true,
    projectPath,
    target,
    stacks: manifest.stacks || [],
    skills: manifest.skills || [],
    mcp: manifest.mcp || [],
    methods: manifest.methods || [],
    paths: {
      skillsDir: at(layout.skillsDir),
      mcpFile: resolveOptional(layout.mcpFile),
      mcpKey: layout.mcpKey,
      rulesFile: resolveOptional(layout.rulesFile),
      constitution: resolveOptional(CONSTITUTION),
      architecture: resolveOptional(ARCHITECTURE)
    }
  };
}

// Resuelve referencias ${VAR} contra el entorno: el .mcp.json equipado guarda los secretos POR
// REFERENCIA (nunca el valor, porque el archivo suele commitearse) y aquí se materializan al conectar.
// Las variables no definidas se dejan intactas (el fallo visible ayuda a diagnosticar).
function resolveEnvRefs(value, env) {
  if (typeof value === 'string') return value.replace(/\$\{(\w+)\}/g, (m, k) => env[k] ?? m);
  if (Array.isArray(value)) return value.map((v) => resolveEnvRefs(v, env));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveEnvRefs(v, env)]));
  return value;
}

// Lee la config de servidores MCP equipados: { id: serverConfig }. Best-effort: {} si no hay archivo o es inválido.
// La clave del objeto varía por target (mcpServers / servers), por eso se pasa mcpKey.
export async function readMcpServers({ mcpFile, mcpKey } = {}, env = process.env) {
  if (!mcpFile || !existsSync(mcpFile)) return {};
  try {
    const json = JSON.parse(await readFile(mcpFile, 'utf8'));
    return resolveEnvRefs(json[mcpKey] || json.mcpServers || json.servers || {}, env);
  } catch {
    return {};
  }
}

// Árbol REAL del proyecto, acotado (profundidad y nº de entradas): la foto que evita que un modelo local
// ADIVINE rutas de memoria (core.module.ts, app.module.ts…) en vez de mirar lo que existe. Determinista:
// lo genera el orquestador, no depende de que el modelo explore bien.
const TREE_IGNORE = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.angular', '.chalc', '.vscode', '.idea']);

export async function projectTree(projectPath, { maxDepth = 3, maxEntries = 80 } = {}) {
  const lines = [];
  let count = 0;
  let truncated = false;
  const walk = async (dir, depth, prefix) => {
    if (depth > maxDepth) return;
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    entries = entries
      .filter((e) => !TREE_IGNORE.has(e.name) && !e.name.startsWith('.'))
      .sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : (a.isDirectory() ? -1 : 1)));
    for (const e of entries) {
      if (count >= maxEntries) { truncated = true; return; }
      count++;
      lines.push(`${prefix}${e.name}${e.isDirectory() ? '/' : ''}`);
      if (e.isDirectory()) await walk(join(dir, e.name), depth + 1, prefix + '  ');
    }
  };
  await walk(projectPath, 1, '');
  return lines.join('\n') + (truncated ? '\n[…truncated]' : '');
}

// Escanea las skills REALMENTE presentes en disco (carpeta con SKILL.md). Superset posible del manifiesto:
// capta skills que el usuario añadió a mano fuera de chalc. Devuelve [] si la carpeta no existe.
async function scanInstalledSkills(skillsDir) {
  if (!skillsDir || !existsSync(skillsDir)) return [];
  const ids = [];
  for (const e of await readdir(skillsDir, { withFileTypes: true })) {
    if (e.isDirectory() && existsSync(join(skillsDir, e.name, 'SKILL.md'))) ids.push(e.name);
  }
  return ids.sort();
}

// Archivos de instrucciones de asistentes que podrían existir en el proyecto (los ponga chalc o no).
// Sirve para reportar "qué tiene el proyecto" aunque no esté equipado por chalc.
const ASSISTANT_FILES = [['CLAUDE.md'], ['GEMINI.md'], ['AGENTS.md'], ['.github', 'copilot-instructions.md'], ['.cursor', 'rules']];

function detectAssistantFiles(projectPath) {
  return ASSISTANT_FILES.filter((parts) => existsSync(join(projectPath, ...parts))).map((parts) => parts.join('/'));
}

// Inspección COMPLETA al abrir un proyecto: manifiesto (loadProject) + detección viva de git, skills y MCP
// reales en disco, y archivos de asistente presentes. Responde "todo lo que tiene el proyecto", no solo lo
// que chalc anotó. Reutiliza gitStatus (lib/gitprep). Funciona incluso sin .chalc.json (equipped:false):
// en ese caso reporta git y asistentes, y omite skills/MCP (sin manifiesto no se sabe su ubicación).
export async function inspectProject(projectPath) {
  const base = await loadProject(projectPath);
  const [git, skills, mcpServers] = await Promise.all([
    gitStatus(projectPath),
    base.equipped ? scanInstalledSkills(base.paths.skillsDir) : Promise.resolve([]),
    base.equipped ? readMcpServers(base.paths) : Promise.resolve({})
  ]);
  return {
    ...base,
    git,
    detected: {
      skills,                             // presentes en disco (puede diferir de manifest.skills)
      mcpServers: Object.keys(mcpServers),
      assistantFiles: detectAssistantFiles(projectPath)
    }
  };
}
