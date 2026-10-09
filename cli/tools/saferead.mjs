// cli/tools/saferead.mjs — lector ÚNICO para todo lo que acaba en un prompt sin pasar por la tool
// `read` (README, instrucciones, constitución, arquitectura, plantilla de spec, skills…). Aplica las
// mismas garantías que las herramientas del agente (V-03): ruta real confinada a la raíz (un enlace
// hacia fuera se rechaza), bytes acotados ANTES de cargar y redacción de secretos.

import { open } from 'node:fs/promises';
import { realpathSync, constants as FS } from 'node:fs';
import { relative, resolve } from 'node:path';
import { resolveInRoot } from './fsconfine.mjs';
import { redactKnownSecrets, redactSecretFile, isSecretFile } from '../../lib/redact.mjs';

export const PROMPT_READ_MAX_BYTES = 256 * 1024;

// O_NOFOLLOW no existe en Windows; allí la revalidación de la ruta real es la única defensa.
const NOFOLLOW = FS.O_NOFOLLOW ?? 0;

// Ruta real confinada: resolveInRoot valida la ruta pedida Y su realpath (enlaces incluidos); se abre
// ese realpath con O_NOFOLLOW, así un enlace puesto entre la validación y la apertura hace fallar la lectura.
function confinedRealPath(root, file) {
  const base = resolve(root);
  const abs = resolveInRoot(base, relative(base, resolve(base, file)));
  return { abs, real: realpathSync(abs) };
}

async function readHead(path, maxBytes) {
  const handle = await open(path, FS.O_RDONLY | NOFOLLOW);
  try {
    const size = Math.min((await handle.stat()).size, maxBytes);
    const buf = Buffer.alloc(size);
    const { bytesRead } = await handle.read(buf, 0, size, 0);
    return buf.subarray(0, bytesRead).toString('utf8');
  } finally { await handle.close(); }
}

// → texto redactado, o null si la ruta sale de la raíz, no existe o no se puede leer. Los archivos de
// credenciales (por la ruta pedida o por la real) llevan la redacción completa; el resto, la de
// secretos inconfundibles, para no romper el código de ejemplo que traen los documentos.
export async function readForPrompt(root, file, { maxBytes = PROMPT_READ_MAX_BYTES } = {}) {
  try {
    const { abs, real } = confinedRealPath(root, file);
    const text = await readHead(real, maxBytes);
    const paths = [abs, real];
    return paths.some(isSecretFile) ? redactSecretFile(text, paths) : redactKnownSecrets(text);
  } catch {
    return null;
  }
}
