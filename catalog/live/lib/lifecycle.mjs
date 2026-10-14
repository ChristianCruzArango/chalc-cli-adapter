// lifecycle.mjs — la vida del tablero (spec 020, R2, R3). Responsabilidad ÚNICA: anunciar el tablero que
// corre, saber si sigue vivo y apagarlo cuando nadie lo mira. Razón de cambio: cómo se reutiliza y cuándo muere.
//
// Este archivo lo emite chalc dentro de `.chalc/live/lib/`. No edites aquí: se regenera al equipar.
//
// El anuncio (`.chalc/live.json`) es lo único que el tablero escribe en el repo: dice en qué URL está y qué
// proceso lo sirve, para que una segunda llamada reutilice el que ya corre en vez de abrir otro.

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const LIVE_REL = '.chalc/live.json';

/** El anuncio vigente `{ url, pid, started }`, o null si no hay o no se entiende. */
export async function readAnnouncement(root) {
  let raw;
  try { raw = JSON.parse(await readFile(join(root, LIVE_REL), 'utf8')); } catch { return null; }
  if (!raw || typeof raw.url !== 'string' || !Number.isInteger(raw.pid)) return null;
  return { url: raw.url, pid: raw.pid, started: String(raw.started ?? '') };
}

/** Anuncia el tablero que acaba de arrancar. */
export async function announce(root, { url, pid }) {
  const path = join(root, LIVE_REL);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ url, pid, started: new Date().toISOString() }, null, 2)}\n`);
}

/** Retira el anuncio, solo si es de `pid`: un tablero viejo no borra el de uno nuevo. */
export async function retire(root, pid) {
  if ((await readAnnouncement(root))?.pid === pid) await rm(join(root, LIVE_REL), { force: true });
}

/** ¿Sigue vivo el proceso? La señal 0 no hace nada: solo pregunta. `EPERM` es «existe, pero no es tuyo». */
export function isAlive(pid, kill = process.kill.bind(process)) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { kill(pid, 0); return true; } catch (err) { return err?.code === 'EPERM'; }
}

/** Un temporizador de inactividad: `onIdle` cuando pasan `ms` sin un `touch()`. */
export function idleTimer(ms, onIdle, { setT = setTimeout, clearT = clearTimeout } = {}) {
  let id = setT(onIdle, ms);
  return {
    touch() { clearT(id); id = setT(onIdle, ms); },
    stop() { clearT(id); }
  };
}
