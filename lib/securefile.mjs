// lib/securefile.mjs — restringe un archivo sensible (la API key vive en ~/.chalc/config.json) a solo su dueño.
// Multiplataforma de verdad: en POSIX basta chmod 0600; en NTFS `chmod` solo togglea el bit de solo-lectura
// (NO aplica ACLs equivalentes a permisos POSIX), así que en Windows usamos icacls para quitar la herencia
// y conceder control únicamente al usuario actual. Best-effort: si el endurecimiento falla, no rompe el guardado.

import { chmodSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { userInfo } from 'node:os';
import { basename, dirname, join } from 'node:path';

export function restrictToOwner(path) {
  if (process.platform === 'win32') {
    try {
      const user = userInfo().username;
      execFileSync('icacls', [path, '/inheritance:r', '/grant:r', `${user}:F`], { stdio: 'ignore' });
    } catch { /* icacls no disponible o falló: queda con los permisos por defecto */ }
  } else {
    try { chmodSync(path, 0o600); } catch { /* permisos best-effort */ }
  }
}

export function restrictDirectoryToOwner(path) {
  if (process.platform === 'win32') {
    try {
      const user = userInfo().username;
      execFileSync('icacls', [path, '/inheritance:r', '/grant:r', `${user}:F`], { stdio: 'ignore' });
    } catch { /* best-effort: no impedir una configuración local por falta de icacls */ }
  } else {
    try { chmodSync(path, 0o700); } catch { /* best-effort */ }
  }
}

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
