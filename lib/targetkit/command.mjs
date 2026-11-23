// lib/targetkit/command.mjs — un comando de proyecto en el formato nativo de cada harness (spec 021, R9;
// spec 024, R20). Responsabilidad ÚNICA: saber dónde lee cada harness sus comandos y cómo se escribe el archivo.
// Razón de cambio: cómo define cada harness sus comandos de proyecto. Qué DICE cada comando lo sabe su módulo
// (`livecommand.mjs`, `speccommand.mjs`).
//
// Formatos y rutas de la documentación oficial de cada harness (2026-10-13): Claude Code, skill en
// `.claude/skills/` → `/nombre`; Codex y Antigravity, skill en `.agents/skills/` → `$nombre` y `/nombre`;
// Cursor, `.cursor/commands/*.md`; Copilot, `.github/prompts/*.prompt.md`.
//
// El texto va en el idioma del SPEC (vive en el repo del usuario, como el bloque de AGENTS.md). Un archivo con
// ese nombre que no lleva la marca de chalc es del usuario: se respalda antes de reemplazarlo.

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { contentLang } from '../contentlang.mjs';
import { backupBeforeReplace } from '../userdata.mjs';
import { MANAGED_MARK, yamlScalar } from './formats.mjs';
import { blockText } from './blocktext.mjs';

// La marca va en el idioma del spec, como el resto del archivo (spec 022, C2).
const markOf = (code) => `<!-- ${MANAGED_MARK}: ${blockText(code).managedNote} -->`;
const skill = (c, extra = []) => ['---', `name: ${c.name}`, `description: ${yamlScalar(c.description)}`, ...extra, '---', '', c.mark, '', ...c.body, ''].join('\n');

// Cada harness: dónde lee sus comandos y cómo se escribe el archivo. `claudeExtra` son líneas de frontmatter
// que solo entiende Claude Code (p. ej. que el comando lo invoque el usuario y no el modelo).
const FORMATS = {
  claude: { file: (name) => ['.claude', 'skills', name, 'SKILL.md'], render: (c) => skill(c, c.claudeExtra) },
  codex: { file: (name) => ['.agents', 'skills', name, 'SKILL.md'], render: (c) => skill(c) },
  antigravity: { file: (name) => ['.agents', 'skills', name, 'SKILL.md'], render: (c) => skill(c) },
  cursor: { file: (name) => ['.cursor', 'commands', `${name}.md`], render: (c) => [c.mark, '', ...c.body, ''].join('\n') },
  copilot: { file: (name) => ['.github', 'prompts', `${name}.prompt.md`], render: (c) => ['---', `description: ${yamlScalar(c.description)}`, '---', '', c.mark, '', ...c.body, ''].join('\n') }
};

/** Dónde deja `target` el comando `name`, con '/'; '' si el target no existe. */
export const commandFile = (target, name) => FORMATS[target]?.file(name).join('/') || '';

/**
 * Escribe el comando `{ name, text: { es, en }, claudeExtra }` de `target` en `projectPath`, en el idioma del spec.
 * Devuelve su ruta, o null si el target no existe.
 */
export async function writeCommand(projectPath, target, { name, text, claudeExtra = [] }, specLang = '') {
  const format = FORMATS[target];
  if (!format) return null;
  const path = join(projectPath, ...format.file(name));
  if (existsSync(path) && !(await readFile(path, 'utf8')).includes(MANAGED_MARK)) await backupBeforeReplace(projectPath, path, 'replaced');
  await mkdir(dirname(path), { recursive: true });
  const code = contentLang(specLang);
  await writeFile(path, format.render({ name, ...text[code], claudeExtra, mark: markOf(code) }));
  return path;
}
