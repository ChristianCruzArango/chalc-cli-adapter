// lib/securefile.mjs — restringe un archivo sensible (la API key vive en ~/.chalc/config.json) a solo su dueño.
// Multiplataforma de verdad: en POSIX basta chmod 0600; en NTFS `chmod` solo togglea el bit de solo-lectura
// (NO aplica ACLs equivalentes a permisos POSIX), así que en Windows usamos icacls para quitar la herencia
// y conceder control únicamente al usuario actual. Best-effort: si el endurecimiento falla, no rompe el guardado.

import { chmodSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { userInfo } from 'node:os';

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
