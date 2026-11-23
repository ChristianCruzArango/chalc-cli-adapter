// ledger.mjs — el registro del equipo en disco (spec 032, R1, R4). Responsabilidad ÚNICA: añadir eventos a
// `.chalc/team/ledger.jsonl` y rehacer `.chalc/team/status.json` a partir de él. Razón de cambio: dónde y cómo
// se guarda lo que hace el equipo.
//
// Este archivo lo emite chalc dentro de `.chalc/team/lib/`. No edites aquí: se regenera al equipar el repo.
//
// El registro solo crece: una línea por evento, fechada aquí y no por quien la manda. `status.json` es una
// foto derivada, reescrita ENTERA y de forma atómica en cada evento: quien la lea nunca la ve a medias, y
// editarla a mano no cambia nada, porque la siguiente escritura la rehace desde el registro.

import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { EVENTS, eventProblem } from './events.mjs';
import { reduce } from './reduce.mjs';

export const LEDGER_REL = '.chalc/team/ledger.jsonl';
export const STATUS_REL = '.chalc/team/status.json';
const OPTIONS_REL = '.chalc/team.json';
const DEFAULTS = Object.freeze({ stallMinutes: 20, maxAttempts: 3 });

const at = (root, rel) => join(root, ...rel.split('/'));
const positive = (value, fallback) => (Number.isFinite(value) && value > 0 ? value : fallback);

/** El umbral de atasco y el tope de intentos de `root`: los de `.chalc/team.json`, o los de por defecto. */
export async function teamOptions(root) {
  let raw = {};
  try { raw = JSON.parse(await readFile(at(root, OPTIONS_REL), 'utf8')) || {}; } catch { /* sin archivo: los de por defecto */ }
  return { stallMs: positive(raw.stallMinutes, DEFAULTS.stallMinutes) * 60000, maxAttempts: positive(raw.maxAttempts, DEFAULTS.maxAttempts) };
}

/** Los eventos del registro, en orden. Una línea rota o de un tipo desconocido se ignora; sin archivo, ninguno. */
export async function readLedger(root) {
  let text;
  try { text = await readFile(at(root, LEDGER_REL), 'utf8'); } catch { return []; }
  return text.split(/\r?\n/)
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .filter((event) => event && typeof event === 'object' && Boolean(EVENTS[event.type]));
}

/** El estado derivado del registro de `root`, calculado ahora. */
export async function readStatus(root, { now = () => new Date() } = {}) {
  return reduce(await readLedger(root), { now: now().getTime(), ...await teamOptions(root) });
}

// Temporal + `rename`: quien lea el archivo ve el anterior o el nuevo, nunca uno a medias.
async function writeStatus(root, status) {
  const file = at(root, STATUS_REL);
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(status, null, 2) + '\n', 'utf8');
  await rename(temp, file);
}

/** Rehace `status.json` de `root` desde su registro. Devuelve el estado. */
export async function refreshStatus(root, { now = () => new Date() } = {}) {
  const status = await readStatus(root, { now });
  await mkdir(dirname(at(root, STATUS_REL)), { recursive: true });
  await writeStatus(root, status);
  return status;
}

/** Registra `event` en `root`. Devuelve { ok, reason, event }; uno que no vale no se escribe. */
export async function appendEvent(root, event, { now = () => new Date() } = {}) {
  const reason = eventProblem(event);
  if (reason) return { ok: false, reason, event: null };
  // La fecha la pone el registro: quien manda el evento no puede fecharlo.
  const { at: _ignored, ...data } = event;
  const stamped = { at: now().toISOString(), ...data };
  await mkdir(dirname(at(root, LEDGER_REL)), { recursive: true });
  await appendFile(at(root, LEDGER_REL), JSON.stringify(stamped) + '\n', 'utf8');
  await refreshStatus(root, { now });
  return { ok: true, reason: '', event: stamped };
}
