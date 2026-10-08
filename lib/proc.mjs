// lib/proc.mjs — ejecutar binarios del ecosistema Node de forma portable.
// En Windows, npx/npm/ng/nest/flutter/yarn/pnpm son shims .cmd/.bat: child_process NO los resuelve por
// PATHEXT sin pasar por cmd.exe, así que `spawn('npx', …)` lanza ENOENT (en macOS/Linux son binarios
// reales y funcionan). Centralizado para que el ajuste por SO viva en un solo lugar.

import { spawn } from 'node:child_process';
import { t } from './i18n.mjs';

export const IS_WINDOWS = process.platform === 'win32';

// Tope de salida que se guarda de un proceso hijo (build, verificación, git diff): de sobra para el
// diagnóstico y sin dejar que un log desbocado llene la memoria.
export const MAX_CHILD_OUTPUT = 4 * 1024 * 1024;

// Lo que cmd.exe interpreta aunque vaya entre comillas, y los saltos de línea.
const CMD_UNSAFE = /[&|<>()^%!\r\n]/;

// La línea de cmd.exe para `file args…`, construida A MANO: con `/s`, cmd quita la primera y la última
// comilla de la línea, así que el quoting automático de Node rompe rutas con espacios. Cada argumento se
// cita si lleva espacios y lo que cmd expandiría igualmente se rechaza: los argumentos pueden venir del
// repo (rutas de un .csproj, carpetas, un compose) y no pueden convertirse en otro comando.
// `allowExpansion` es solo para los servidores MCP: su comando lo aprobó el usuario viéndolo entero, y
// sus argumentos llevan a menudo URLs con contraseñas codificadas (`%40`), que rechazar rompería.
export function windowsCommand(file, args = [], { allowExpansion = false } = {}) {
  const pieces = [file, ...args].map(String);
  const bad = allowExpansion ? undefined : pieces.find((item) => CMD_UNSAFE.test(item));
  if (bad !== undefined) throw new Error(t('procUnsafeArg', bad));
  const quote = (value) => (/[\s"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const comspec = process.env.ComSpec || 'cmd.exe';
  return { file: comspec, args: ['/d', '/s', '/c', `"${pieces.map(quote).join(' ')}"`], windowsVerbatimArguments: true };
}

// Baja el ÁRBOL de procesos de `child`: en Windows, taskkill /T sobre el wrapper cmd.exe (matar solo
// el wrapper dejaría huérfano al proceso real); en POSIX, el grupo de procesos si el hijo es líder de
// uno (`detached`), y si no, el propio hijo. Se mira si el proceso SIGUE VIVO (exitCode/signalCode),
// no `child.killed`: este pasa a true en cuanto se ENVÍA la primera señal, y entonces una escalada a
// SIGKILL no llegaba a salir nunca.
export function killTree(child, signal = 'SIGTERM') {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (IS_WINDOWS) {
    try { spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); return; } catch { /* fallback abajo */ }
  }
  try { process.kill(-child.pid, signal); } catch {
    try { child.kill(signal); } catch { /* ya terminó */ }
  }
}

// Argumentos para spawn/execFile: `[archivo, args, opciones]`. En POSIX, tal cual (sin shell); en
// Windows, a través de cmd.exe con la línea de `windowsCommand`. Antes era `shell: true`, y con
// argumentos del repo eso permitía inyectar o, como mínimo, partía las rutas con espacios.
export function portable(command, args = [], opts = {}) {
  if (!IS_WINDOWS) return [command, args, opts];
  const cmd = windowsCommand(command, args);
  return [cmd.file, cmd.args, { ...opts, windowsVerbatimArguments: true }];
}
