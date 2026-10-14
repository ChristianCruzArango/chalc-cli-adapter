// lib/skillsource/risk.mjs — claves del frontmatter de una skill de terceros que amplían lo que el
// agente puede hacer sin preguntar (S6): `allowed-tools` (permisos pre-aprobados) y `hooks` (comandos
// que el asistente ejecuta solo). `readSkillMeta` solo lee name/description; esto mira lo demás.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const RISKY_KEYS = ['allowed-tools', 'hooks'];

// El bloque `---…---` del inicio, o '' si no hay.
function frontmatter(text) {
  const m = text.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  // Stryker disable next-line StringLiteral: sin frontmatter, cualquier texto sin `clave:` declara las mismas claves (ninguna)
  return m ? m[1] : '';
}

// Las claves de riesgo declaradas en el nivel raíz del frontmatter de `<dir>/SKILL.md`, en orden fijo.
export async function riskyFrontmatterKeys(dir) {
  let text;
  try { text = await readFile(join(dir, 'SKILL.md'), 'utf8'); } catch { return []; }
  const declared = new Set(frontmatter(text).split(/\r?\n/).map((l) => l.match(/^([A-Za-z][\w-]*)\s*:/)?.[1]?.toLowerCase()));
  return RISKY_KEYS.filter((k) => declared.has(k) || declared.has(k.replace('-', '_')) || declared.has(k.replace('-', '')));
}
