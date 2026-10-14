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

// Abre `path` sin seguir enlaces y lee como mucho `maxBytes` del archivo ABIERTO (su fstat, no el de
// una ruta que pudo cambiar). `whole`: si el archivo supera el tope no se lee nada (buf null). Solo se
// leen archivos regulares: en POSIX un directorio falla al leer (EISDIR), pero en Windows se abre y se lee
// como si estuviera vacío; por eso se comprueba el tipo del archivo ABIERTO en todos los sistemas.
async function readOpened(path, maxBytes, { whole = false } = {}) {
  const handle = await open(path, FS.O_RDONLY | NOFOLLOW);
  try {
    const st = await handle.stat();
    if (!st.isFile()) throw Object.assign(new Error(`not a regular file: ${path}`), { code: 'EISDIR' });
    if (whole && st.size > maxBytes) return { size: st.size, buf: null };
    const size = Math.min(st.size, maxBytes);
    const buf = Buffer.alloc(size);
    const { bytesRead } = await handle.read(buf, 0, size, 0);
    return { size: st.size, buf: buf.subarray(0, bytesRead) };
  } finally { await handle.close(); }
}

const readHead = async (path, maxBytes) => (await readOpened(path, maxBytes)).buf.toString('utf8');

// Lectura confinada de las herramientas del agente (read/edit): la ruta real validada se abre con
// O_NOFOLLOW y el tamaño es el del archivo abierto, sin carrera entre la validación y la lectura.
// → { size, buf } (buf null si supera `maxBytes`). Lanza si sale de la raíz o no se puede abrir.
export async function readConfinedBytes(root, file, maxBytes) {
  const { real } = confinedRealPath(root, file);
  return readOpened(real, maxBytes, { whole: true });
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
