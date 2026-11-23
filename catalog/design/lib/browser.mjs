// browser.mjs — el navegador del sistema (spec 039, R3). Responsabilidad ÚNICA: decir dónde hay un Chrome, Edge o
// Chromium con el que medir. Razón de cambio: dónde instala cada sistema su navegador.
//
// Este archivo lo emite chalc dentro de `.chalc/design/lib/`. No edites aquí: se regenera al equipar el repo.
//
// No se descarga ni se instala nada: se usa el navegador que la máquina ya tiene. `CHALC_BROWSER` nombra otro.
// Sin ninguno no hay medición, y eso se dice: una interfaz que nadie midió no está aprobada.

import { existsSync } from 'node:fs';
import { win32 } from 'node:path';

const MAC = Object.freeze(['Google Chrome', 'Microsoft Edge', 'Chromium'].map((app) => `/Applications/${app}.app/Contents/MacOS/${app}`));
const LINUX = Object.freeze(['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium']);
const WINDOWS_ROOTS = Object.freeze(['ProgramFiles', 'ProgramFiles(x86)', 'LocalAppData']);
const WINDOWS_APPS = Object.freeze([['Google', 'Chrome', 'Application', 'chrome.exe'], ['Microsoft', 'Edge', 'Application', 'msedge.exe']]);

// En Windows las variables de entorno no distinguen mayúsculas (`Path`, `ProgramFiles`…).
function envOf(env, name) {
  const key = Object.keys(env).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key ? String(env[key] ?? '').trim() : '';
}

function ownCandidates(platform, env) {
  if (platform === 'darwin') return [...MAC];
  if (platform === 'linux') return [...LINUX];
  if (platform !== 'win32') return [];
  return WINDOWS_ROOTS.map((name) => envOf(env, name)).filter(Boolean).flatMap((root) => WINDOWS_APPS.map((app) => win32.join(root, ...app)));
}

/** Dónde buscar el navegador en `platform`, en orden: primero el de `CHALC_BROWSER`. */
export function browserCandidates(platform, env) {
  const chosen = envOf(env, 'CHALC_BROWSER');
  return [...(chosen ? [chosen] : []), ...ownCandidates(platform, env)];
}

/** La ruta del navegador con el que medir, o '' si la máquina no tiene ninguno. */
export function findBrowser({ platform = process.platform, env = process.env, exists = existsSync } = {}) {
  return browserCandidates(platform, env).find((path) => exists(path)) || '';
}
