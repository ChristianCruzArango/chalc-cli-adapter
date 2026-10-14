// activity.mjs — el registro de actividad del tablero (spec 020, R8). Responsabilidad ÚNICA: convertir el
// evento de un hook en una línea del registro, y leer las últimas. Razón de cambio: qué se cuenta de cada
// acción. Puro: quien lee stdin y escribe el archivo es `record.mjs`.
//
// Este archivo lo emite chalc dentro de `.chalc/live/lib/`. No edites aquí: se regenera al equipar.
//
// Lo que se registra es QUIÉN hizo QUÉ y DÓNDE, nunca el contenido: ni lo que se escribe en un archivo, ni
// lo que responde una herramienta, ni el prompt con el que se lanza un rol. El registro lo lee una página,
// y una página no puede ser la vía por la que un secreto sale del repo. Lo que podría serlo se redacta.
//
// Quién: Claude Code añade `agent_type` (p. ej. `revisor`) a cada evento que ocurre DENTRO de un subagente;
// sin él, la acción es del agente principal. Comprobado con eventos reales.

import { isAbsolute, relative } from 'node:path';
import { redactSensitiveText } from '../../gate/lib/redact.mjs';

export const ACTIVITY_REL = '.chalc/activity.jsonl';
export const MAX_LINES = 500;

const MAX_SUMMARY = 120;
const PATH_TOOLS = new Set(['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookRead', 'NotebookEdit']);
const KINDS = { SubagentStart: 'start', SubagentStop: 'stop', Stop: 'turn-end' };

const shorten = (text) => (text.length > MAX_SUMMARY ? `${text.slice(0, MAX_SUMMARY)}…` : text);
const clean = (text) => shorten(redactSensitiveText(String(text ?? '').replace(/\s+/g, ' ').trim()));

// La ruta como se lee en el repo: relativa a la raíz si está dentro, tal cual si no.
function shown(path, root) {
  const value = String(path ?? '');
  if (!value || !root || !isAbsolute(value)) return value;
  const rel = relative(root, value).replace(/\\/g, '/');
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : value;
}

// El resumen de UNA herramienta: dónde actúa, nunca con qué contenido.
function summaryOf(tool, input, root) {
  if (PATH_TOOLS.has(tool)) return shown(input.file_path ?? input.notebook_path, root);
  if (tool === 'Bash') return clean(input.command);
  if (tool === 'Grep') return clean([input.pattern, shown(input.path, root)].filter(Boolean).join(' · '));
  if (tool === 'Glob') return clean(input.pattern);
  if (tool === 'Agent' || tool === 'Task') return clean([input.subagent_type, input.description].filter(Boolean).join(' · '));
  return '';
}

/** La línea del registro para un evento de hook, o null si no es uno que se registre. */
export function activityOf(event, { root = '', now = new Date() } = {}) {
  if (!event || typeof event !== 'object') return null;
  const base = { at: now.toISOString(), who: event.agent_type || 'principal' };
  const kind = KINDS[event.hook_event_name];
  if (kind) return { ...base, kind };
  if (event.hook_event_name !== 'PreToolUse' || typeof event.tool_name !== 'string') return null;
  return { ...base, kind: 'tool', tool: event.tool_name, summary: summaryOf(event.tool_name, event.tool_input || {}, root || event.cwd) };
}

/** Las últimas `n` líneas no vacías de un texto, en orden. */
export function lastLines(text, n = MAX_LINES) {
  return String(text ?? '').split(/\r?\n/).filter(Boolean).slice(-n);
}
