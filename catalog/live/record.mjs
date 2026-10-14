// record.mjs — el hook que escribe el registro de actividad del tablero (spec 020, R8, R9). Responsabilidad
// ÚNICA: convertir el evento recibido por stdin en una línea de `.chalc/activity.jsonl` y en los tokens de la
// tarea en curso (`.chalc/usage.json`, R12). Razón de cambio: cómo llega el evento. Qué se registra lo
// deciden `lib/activity.mjs` y `lib/usage.mjs`.
//
// Este archivo lo emite chalc dentro de `.chalc/live/`. Se invoca desde un hook de Claude Code
// (documentado en `.chalc/gate-hook.md`, nunca instalado):
//
//   node .chalc/live/record.mjs
//
// Reglas de oficio, porque corre dentro del turno del agente y en `PreToolUse`: no imprime NADA (una salida
// ahí se leería como una decisión sobre la acción), sale SIEMPRE con 0 y nunca espera una entrada que no
// llega. Quedarse sin una línea en el tablero es mucho mejor que romper el turno.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACTIVITY_REL, MAX_LINES, activityOf, lastLines } from './lib/activity.mjs';
import { USAGE_REL, ZERO, addUsage, currentTaskId, usageOf } from './lib/usage.mjs';
import { readNew } from './lib/transcript.mjs';
import { withLock } from './lib/lock.mjs';
import { readStdin } from '../gate/lib/stdin.mjs';
import { loadConfig } from '../gate/lib/config.mjs';
import { newestSpec } from '../gate/lib/spec.mjs';

/** Añade al registro de `root` la línea del evento `text`. Devuelve la línea, o null si no había nada que anotar. */
export async function recordActivity(root, text, { now = new Date(), max = MAX_LINES } = {}) {
  let event;
  try { event = JSON.parse(text); } catch { return null; }
  const found = activityOf(event, { root, now });
  if (!found) return null;
  const line = { ...found, task: currentTaskId(await tasksText(root)) };

  // Registro y acumulado bajo el mismo candado: los hooks de varias herramientas a la vez corren en paralelo.
  await withLock(root, async () => {
    await appendLine(root, line, max);
    await chargeUsage(root, event, line);
  });
  return line;
}

// El tasks.md de la spec vigente, el mismo que lee el advisor. Sin spec, la acción no es de ninguna tarea.
async function tasksText(root) {
  try {
    const { config } = await loadConfig(root);
    return (await newestSpec(root, config.spec?.dir || 'specs', 'tasks.md'))?.text || '';
  } catch { return ''; }
}

// Una lectura y una escritura por evento: con el tope en cientos de líneas cuesta poco, y el archivo nunca
// crece sin fin. Lo anterior se queda en sus últimas `max - 1` líneas, más la nueva.
async function appendLine(root, line, max) {
  const path = join(root, ACTIVITY_REL);
  await mkdir(dirname(path), { recursive: true });
  const before = lastLines(await readFile(path, 'utf8').catch(() => ''), max - 1);
  await writeFile(path, `${[...before, JSON.stringify(line)].join('\n')}\n`);
}

// Lo nuevo de cada transcript que nombra el evento —el de la sesión y, al salir un rol, el suyo—, cargado a la
// tarea de la línea. Sin transcript, el evento igual marca el tiempo de la tarea.
async function chargeUsage(root, event, line) {
  const path = join(root, USAGE_REL);
  let store;
  try { store = JSON.parse(await readFile(path, 'utf8')); } catch { /* ausente o roto: `addUsage` empieza de cero */ }
  // Primero sin tokens: deja el acumulado sano (un archivo roto vuelve a empezar) y con la tarea creada.
  store = addUsage(store, { task: line.task, tokens: ZERO, at: line.at });
  const tokens = { ...ZERO };
  for (const file of new Set([event.transcript_path, event.agent_transcript_path].filter((p) => typeof p === 'string' && p))) {
    const cursor = store.cursors[file] || {};
    const fresh = await readNew(file, cursor.offset);
    const counted = usageOf(fresh.text, cursor.seen);
    store.cursors[file] = { offset: fresh.offset, seen: counted.seen };
    for (const key of Object.keys(tokens)) tokens[key] += counted.tokens[key];
  }
  await writeFile(path, JSON.stringify(addUsage(store, { task: line.task, tokens, at: line.at })));
}

// Entrada del hook. La raíz la da Claude Code en `CLAUDE_PROJECT_DIR`; la shell puede estar en una subcarpeta.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await recordActivity(process.env.CLAUDE_PROJECT_DIR || process.cwd(), await readStdin()); } catch { /* nunca romper el turno */ }
  process.exit(0);
}
