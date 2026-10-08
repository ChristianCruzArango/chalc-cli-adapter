// lib/targetkit/roles.mjs — los roles (revisor y compañía) proyectados al formato de cada target,
// y la guía del hook del portón.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { lang } from '../i18n.mjs';
import { toolsFor } from '../roles.mjs';
import { mdc, yamlScalar } from './formats.mjs';

// --- Agente revisor (spec 007, R12) ------------------------------------------------------------
// El revisor entra al cerrar cada tarea, después del portón. El portón mide; el revisor juzga lo que
// no se puede medir. Se proyecta con el formato de CADA target porque el texto es el mismo pero el
// sitio donde el asistente lo lee no lo es.

// El alcance de cada rol vive en su `contract.json` (spec 009): qué escribe, qué no y qué
// herramientas necesita. Aquí ya no hay ninguna constante que pueda desincronizarse con la prosa
// del prompt — `toolsFor` deriva la lista y rechaza un contrato que conceda de más.

// El cuerpo de un rol, en el idioma del spec y con las skills activas de ESTE repo. Un revisor de
// back no puede auditar contra reglas de Flutter, así que la lista no es decorativa.
export async function roleText(CATALOG, role, { skills = [], specLang = '' } = {}) {
  const code = String(specLang || lang).toLowerCase().startsWith('es') ? 'es' : 'en';
  const file = join(CATALOG, 'agents', role.id, code === 'es' ? 'agent.md' : 'agent.en.md');
  const body = await readFile(file, 'utf8');

  const list = skills.length
    ? skills.map((s) => `- \`${s}\``).join('\n')
    : (code === 'es' ? '- (ninguna skill equipada)' : '- (no skills equipped)');
  return { code, text: body.replace('{{SKILLS}}', list) };
}

// Aviso para los targets SIN modelo de permisos (spec 009, R5). Ahí el alcance de un rol es una
// instrucción, no una restricción: el CLI no tiene forma de impedir que la incumpla. Decirlo permite
// al usuario juzgar si le basta; callarlo sería vender una garantía que no existe.
function scopeNotice(role, code) {
  const writes = (role.writes || []).map((w) => `\`${w}\``).join(', ');
  return code === 'es'
    ? `> **Alcance (instrucción, no restricción).** Este CLI no concede permisos por agente: nada impide `
      + `técnicamente que se salte lo de abajo. Escribe ÚNICAMENTE ${writes || 'ningún archivo'}; ningún otro archivo del repo.`
    : `> **Scope (an instruction, not a restriction).** This CLI grants no per-agent permissions: nothing `
      + `technically prevents ignoring the line below. Write ONLY ${writes || 'no file at all'}; no other file in the repo.`;
}

// Las líneas de un rol para el bloque gestionado de un target markdown (AGENTS.md, GEMINI.md,
// copilot-instructions.md): ahí no hay subagentes, así que va como sección del mismo bloque.
export async function roleLines(CATALOG, role, { skills = [], specLang = '' } = {}) {
  const { code, text } = await roleText(CATALOG, role, { skills, specLang });
  const title = code === 'es'
    ? `## 🔍 Agente ${role.id} (al cerrar ${role.cadence === 'feature' ? 'la feature' : 'cada tarea'})`
    : `## 🔍 ${role.id} agent (when closing ${role.cadence === 'feature' ? 'the feature' : 'each task'})`;
  return ['', title, '', scopeNotice(role, code), '', text];
}

// Escribe un rol como archivo propio. `kind`:
//   'agent' → subagente de Claude Code, con frontmatter y las herramientas de su contrato.
//   'rule'  → regla de Cursor (.mdc), sin modelo de permisos: lleva el aviso de alcance.
export async function writeRole(projectPath, CATALOG, role, { skills = [], specLang = '', kind = 'agent', file } = {}) {
  const { code, text } = await roleText(CATALOG, role, { skills, specLang });

  if (kind === 'rule') {
    const dest = file || join(projectPath, '.cursor', 'rules', `chalc-${role.id}.mdc`);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, mdc({ description: role.summary[code], body: `${scopeNotice(role, code)}\n\n${text}` }), 'utf8');
    return dest;
  }

  const dest = file || join(projectPath, '.claude', 'agents', `${role.id}.md`);
  const front = ['---', `name: ${yamlScalar(role.id)}`, `description: ${yamlScalar(role.summary[code])}`, `tools: ${toolsFor(role).join(', ')}`, '---', ''];
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, front.join('\n') + '\n' + text, 'utf8');
  return dest;
}

// Deja el hook de cierre de turno DOCUMENTADO en `.chalc/gate-hook.md` (spec 007, R19).
//
// No se instala a propósito. Un hook se ejecuta solo y `.claude/settings.json` va commiteado:
// activarlo desde chalc se lo impondría a todo el que clone el repo, que no pidió nada. chalc deja el
// bloque listo y explica qué hace; la decisión es del usuario, y el archivo no es configuración
// activa — es documentación dentro de la carpeta que chalc ya gestiona.
export async function writeGateHookDoc(projectPath, CATALOG, { specLang = '' } = {}) {
  const code = String(specLang || lang).toLowerCase().startsWith('es') ? 'es' : 'en';
  const source = join(CATALOG, 'hooks', code === 'es' ? 'gate-hook.md' : 'gate-hook.en.md');
  if (!existsSync(source)) return null;

  const dest = join(projectPath, '.chalc', 'gate-hook.md');
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, await readFile(source, 'utf8'), 'utf8');
  return dest;
}
