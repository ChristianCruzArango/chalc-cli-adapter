// lib/tokenlog.mjs — histórico persistente de consumo IA por proyecto (specs/002-chalc-tokens, R1-R3).
// Responsabilidad única: acumular en memoria un evento por llamada de IA (con los metadatos que el
// embudo ya conoce) y persistirlos en .chalc/tokens.jsonl del proyecto. Best-effort SIEMPRE: el
// histórico jamás puede romper un comando que ya pagó tokens, por eso nada aquí lanza.

import { mkdir, appendFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { normalizeUsage } from './tokenmeter.mjs';

const LOG_REL = join('.chalc', 'tokens.jsonl');

// Buffer del proceso: un comando = un proceso (igual que tokenmeter), así que basta estado de módulo.
let events = [];
let command = '';
let project = '';

// Etiqueta del comando en curso (verbo del bin o 'cli' en la shell); la fija el entrypoint una vez.
export function setTokenLogCommand(cmd) {
  command = String(cmd || '');
}

// Proyecto REAL donde persistir: lo fijan los comandos que resuelven su ruta por dentro (spec-ia,
// feature, init) — para esos verbos el projectPath del contexto del bin es bogus. Gana al fallback.
export function setTokenLogProject(projectPath) {
  project = String(projectPath || '');
}

// Registra UNA llamada de IA. La llaman los embudos (lib/ai.mjs, cli/engine/model.mjs) justo donde
// ya miden tokens; normaliza el usage con el mismo criterio que tokenmeter para no divergir.
export function logAiCall(meta, usage) {
  try {
    const u = normalizeUsage(usage && typeof usage === 'object' ? usage : {});
    events.push({
      ts: new Date().toISOString(),
      command,
      task: String(meta?.task || 'default'),
      provider: String(meta?.provider || ''),
      model: String(meta?.model || ''),
      input: u.input,
      output: u.output,
      calls: 1
    });
  } catch { /* best-effort: medir jamás rompe la llamada */ }
}

// Persiste el buffer en <proyecto>/.chalc/tokens.jsonl (append-only) y lo vacía. El proyecto
// explícito (setTokenLogProject) gana; el argumento es el fallback del entrypoint (qa/deliver/apply).
// Devuelve la ruta escrita, o null si no había eventos, no hay proyecto o la escritura falló (R3).
export async function flushTokenLog(fallbackProjectPath) {
  const target = project || fallbackProjectPath;
  if (!target || !events.length) return null;
  // El proyecto debe EXISTIR: si un comando falló antes de crear/resolver su carpeta, mejor perder
  // el registro que inventar un directorio bogus (p. ej. ./init/.chalc en el cwd).
  if (!existsSync(String(target))) return null;
  const file = join(String(target), LOG_REL);
  const lines = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
  try {
    await mkdir(dirname(file), { recursive: true });
    await appendFile(file, lines, 'utf8');
    events = [];
    return file;
  } catch {
    return null;   // sin permisos / disco lleno / .chalc no es carpeta: el comando sigue
  }
}

// Lee el histórico completo del proyecto. Las líneas corruptas (proceso matado a mitad de un
// append, ediciones a mano) se saltan: el reporte trabaja con lo recuperable, nunca revienta.
export async function readTokenLog(projectPath) {
  if (!projectPath) return [];
  try {
    const raw = await readFile(join(String(projectPath), LOG_REL), 'utf8');
    return raw.split('\n').filter(Boolean).flatMap((line) => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
  } catch {
    return [];   // sin histórico aún
  }
}

// Reinicia el estado del módulo (para tests; en el CLI cada proceso arranca limpio).
export function resetTokenLog() {
  events = [];
  command = '';
  project = '';
}
