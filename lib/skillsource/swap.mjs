// lib/skillsource/swap.mjs — reemplazo atómico de la carpeta de una skill: se prepara y valida una copia
// hermana y después se intercambia por rename. Un disco lleno o un proceso interrumpido nunca borra la
// skill que ya funcionaba, y lo que la fuente retiró no sobrevive (F3: `cp` encima mezclaba).

import { rename, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

// `populate(staged)` llena y valida la copia; si lanza, `dest` queda intacto.
export async function replaceDir(dest, populate) {
  const parent = dirname(dest);
  const nonce = randomUUID();
  const staged = join(parent, `.${basename(dest)}.${nonce}.next`);
  const backup = join(parent, `.${basename(dest)}.${nonce}.previous`);
  let movedOld = false;
  try {
    await populate(staged);
    if (existsSync(dest)) {
      await rename(dest, backup);
      movedOld = true;
    }
    await rename(staged, dest);
  } catch (error) {
    // Si el segundo rename falla, recuperar la versión anterior es más importante que propagar el error.
    if (movedOld && !existsSync(dest) && existsSync(backup)) {
      try { await rename(backup, dest); } catch { /* el error original conserva el contexto */ }
    }
    throw error;
  } finally {
    await rm(staged, { recursive: true, force: true }).catch(() => {});
    await rm(backup, { recursive: true, force: true }).catch(() => {});
  }
  return dest;
}
