// lib/targetkit/formats.mjs — formatos que chalc escribe en los proyectos: el bloque gestionado
// (markdown y TOML), las tablas MCP de Codex y el frontmatter YAML de las reglas .mdc.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { assertSafeId } from '../ids.mjs';
import { t } from '../i18n.mjs';

export const START = '<!-- chalc:start -->';
export const END = '<!-- chalc:end -->';
// Marcadores para archivos TOML (comentarios válidos): mismo principio de bloque gestionado que en markdown.
export const TOML_START = '# chalc:start (no editar este bloque a mano)';
export const TOML_END = '# chalc:end';

// Marca de lo que chalc genera. Lo que la lleva es de chalc y se reemplaza al equipar; lo que no,
// puede ser del usuario y se respalda antes de tocarlo.
export const MANAGED_MARK = 'chalc:managed';

const occurrences = (text, marker) => text.split(marker).length - 1;

// `markers` permite gestionar bloques en formatos donde los comentarios HTML no valen (p. ej. TOML).
//
// Solo se reemplaza cuando hay EXACTAMENTE un inicio y un fin, en ese orden. Con un inicio huérfano
// (el usuario borró la última línea) se añadía un bloque nuevo al final y, en la ejecución siguiente,
// el reemplazo iba del inicio huérfano al fin del bloque nuevo y se llevaba por delante todo lo que el
// usuario escribió entre medias. Ante marcadores descabalados no se toca el archivo: se avisa y el
// bloque nuevo queda en `<archivo>.chalc-pending` para pegarlo a mano.
export async function writeManagedBlock(file, block, { start = START, end = END } = {}) {
  await mkdir(dirname(file), { recursive: true });
  const content = existsSync(file) ? await readFile(file, 'utf8') : '';
  const starts = occurrences(content, start);
  const ends = occurrences(content, end);
  let next;
  if (starts === 0 && ends === 0) {
    next = content.trimEnd() + (content ? '\n\n' : '') + block + '\n';
  } else if (starts === 1 && ends === 1 && content.indexOf(start) < content.indexOf(end)) {
    const from = content.indexOf(start);
    const to = content.indexOf(end) + end.length;
    next = content.slice(0, from) + block + content.slice(to);
  } else {
    const pending = `${file}.chalc-pending`;
    await writeFile(pending, block + '\n');
    console.warn(`  ! ${t('kitMarkersUnpaired', file, starts, ends, pending)}`);
    return { written: false, pending };
  }
  await writeFile(file, next.endsWith('\n') ? next : next + '\n');
  return { written: true };
}

// Serializa un escalar/array a TOML. Los strings van como basic strings (JSON.stringify es compatible).
function tomlValue(v) {
  if (Array.isArray(v)) return `[${v.map(tomlValue).join(', ')}]`;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(String(v));
}

// Clave TOML: bare si puede, citada si no (p. ej. env con puntos).
function tomlKey(k) {
  return /^[A-Za-z0-9_-]+$/.test(k) ? k : JSON.stringify(String(k));
}

// mcps → tablas TOML [mcp_servers.<id>] (formato de Codex CLI). Escalares/arrays inline;
// objetos anidados (env) como sub-tabla [mcp_servers.<id>.<clave>].
export function tomlMcpServers(mcps) {
  const lines = [];
  for (const m of mcps || []) {
    const id = assertSafeId(m.id, 'MCP id');
    lines.push(`[mcp_servers.${id}]`);
    const nested = [];
    for (const [k, v] of Object.entries(m.server || {})) {
      if (v && typeof v === 'object' && !Array.isArray(v)) { nested.push([k, v]); continue; }
      lines.push(`${tomlKey(k)} = ${tomlValue(v)}`);
    }
    for (const [k, obj] of nested) {
      lines.push('', `[mcp_servers.${id}.${tomlKey(k)}]`);
      for (const [ek, ev] of Object.entries(obj)) lines.push(`${tomlKey(ek)} = ${tomlValue(ev)}`);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd() + (lines.length ? '\n' : '');
}

// Un valor de frontmatter YAML válido. Texto llano cuando no hay nada que YAML pueda malinterpretar;
// si no, comillas dobles con escapes JSON (un subconjunto válido de YAML). Sin esto, un resumen con
// «: » (`Revisa: …`) hacía fallar a cualquier parser estricto con «mapping values are not allowed».
const YAML_PLAIN = /^[\p{L}\p{N}][\p{L}\p{N} _.()/-]*$/u;
const YAML_RESERVED = /^(true|false|yes|no|on|off|null|~)$/i;
export function yamlScalar(value) {
  const text = String(value ?? '');
  return YAML_PLAIN.test(text) && !text.endsWith(' ') && !YAML_RESERVED.test(text) ? text : JSON.stringify(text);
}

// El valor de una línea `clave: valor` de frontmatter, sin las comillas con que pudo escribirse.
export function yamlValue(raw) {
  const text = raw.trim();
  if (text.startsWith('"')) { try { return JSON.parse(text); } catch { return text; } }
  if (text.startsWith("'") && text.endsWith("'") && text.length > 1) return text.slice(1, -1).replace(/''/g, "'");
  return text;
}

// Construye un archivo .mdc (Cursor) con frontmatter.
export function mdc({ description = '', globs = '', alwaysApply = false, body = '' }) {
  const fm = ['---', `description: ${yamlScalar(description)}`];
  if (globs) fm.push(`globs: ${globs}`);
  fm.push(`alwaysApply: ${alwaysApply}`, '---');
  return fm.join('\n') + '\n\n' + body.trim() + `\n\n<!-- ${MANAGED_MARK} -->\n`;
}
