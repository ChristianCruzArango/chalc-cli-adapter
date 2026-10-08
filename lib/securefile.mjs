// lib/securefile.mjs — restringe un archivo sensible (la API key vive en ~/.chalc/config.json) a solo su dueño.
// Multiplataforma de verdad: en POSIX basta chmod 0600; en NTFS `chmod` solo togglea el bit de solo-lectura
// (NO aplica ACLs equivalentes a permisos POSIX), así que en Windows usamos icacls para quitar la herencia
// y conceder control únicamente al usuario actual. Best-effort: si el endurecimiento falla, no rompe el guardado.

import { chmodSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { userInfo } from 'node:os';
import { basename, dirname, join } from 'node:path';

// Solo el dueño: en Windows, icacls sin herencia y control total para el usuario actual; en POSIX,
// el modo dado. Best-effort: si el endurecimiento falla, no impide guardar la configuración local.
function restrict(path, posixMode) {
  if (process.platform === 'win32') {
    try { execFileSync('icacls', [path, '/inheritance:r', '/grant:r', `${userInfo().username}:F`], { stdio: 'ignore' }); }
    catch { /* icacls no disponible o falló: queda con los permisos por defecto */ }
    return;
  }
  try { chmodSync(path, posixMode); } catch { /* permisos best-effort */ }
}

export const restrictToOwner = (path) => restrict(path, 0o600);
export const restrictDirectoryToOwner = (path) => restrict(path, 0o700);

// Escribe credenciales/configuración sin una ventana de archivo 0644: temporal 0600 + rename en el
// mismo directorio. Se mantiene síncrona para que `chalc lang` (también síncrono) use la misma garantía.
export function writeSecureFileSync(path, contents) {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  restrictDirectoryToOwner(dir);
  const temp = join(dir, `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
  try {
    writeFileSync(temp, contents, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    restrictToOwner(temp);
    renameSync(temp, path);
    restrictToOwner(path);
  } finally {
    try { rmSync(temp, { force: true }); } catch { /* ya fue renombrado */ }
  }
  return path;
}
