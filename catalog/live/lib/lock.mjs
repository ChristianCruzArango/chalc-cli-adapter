// lock.mjs — un candado entre hooks (spec 020, R12). Responsabilidad ÚNICA: que dos procesos no reescriban a
// la vez el mismo archivo. Razón de cambio: cómo se espera y cuándo se da por muerto a quien lo tiene.
//
// Este archivo lo emite chalc dentro de `.chalc/live/lib/`. No edites aquí: se regenera al equipar.
//
// Cuando el agente lanza varias herramientas a la vez, Claude Code corre sus hooks `PreToolUse` en paralelo, y
// cada uno lee y reescribe el registro y el acumulado de tokens: sin candado, el último que escribe borra lo de
// los demás. `mkdir` es atómico en todos los sistemas: o lo crea uno o falla. Un candado más viejo que
// `STALE_MS` es de un hook que murió con él tomado, y se recupera. Si no se consigue a tiempo, el trabajo NO
// corre: perder una línea del tablero es mejor que hacer esperar al turno.

import { mkdir, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const LOCK_REL = '.chalc/usage.lock';
export const STALE_MS = 10_000;

const pause = (ms) => new Promise((done) => { setTimeout(done, ms); });

async function take(path) {
  try { await mkdir(path); return true; } catch { return false; }
}

async function isStale(path) {
  try { return Date.now() - (await stat(path)).mtimeMs > STALE_MS; } catch { return false; }
}

// Recupera un candado viejo SIN carrera. Borrarlo sin más podía llevarse el que otro hook acababa de tomar
// en su lugar (dos lo ven viejo; uno lo borra y toma uno nuevo; el otro borra ESE). Por eso la recuperación
// tiene su propio candado (`mkdir`, atómico): solo uno recupera a la vez, y vuelve a mirar dentro antes de
// borrar —si ya es uno recién tomado, no lo toca—. Ese candado solo dura dos llamadas al disco; si quedó de
// un hook muerto, también caduca.
// Se exporta para probar la recuperación sin depender de una carrera real.
export async function reclaim(path) {
  const guard = `${path}.reclaim`;
  if (!(await take(guard))) {
    if (await isStale(guard)) await rm(guard, { recursive: true, force: true });
    return;
  }
  try {
    if (await isStale(path)) await rm(path, { recursive: true, force: true });
  } finally {
    await rm(guard, { recursive: true, force: true });
  }
}

/** Corre `work` con el candado de `root` tomado y devuelve su resultado; `undefined` si no lo consiguió. */
export async function withLock(root, work, { tries = 40, waitMs = 25 } = {}) {
  const path = join(root, LOCK_REL);
  await mkdir(dirname(path), { recursive: true });
  for (let i = 0; i < tries; i += 1) {
    if (await take(path)) {
      try { return await work(); } finally { await rm(path, { recursive: true, force: true }); }
    }
    if (await isStale(path)) await reclaim(path);
    else await pause(waitMs);
  }
  return undefined;
}
