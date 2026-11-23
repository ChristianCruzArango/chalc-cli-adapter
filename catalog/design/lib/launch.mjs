// launch.mjs — lanzar el navegador del sistema para medir (spec 039, R3, R5). Responsabilidad ÚNICA: arrancarlo
// sin ventana con un perfil temporal, dar la sesión para hablarle y cerrarlo del todo. Razón de cambio: cómo se lanza.
//
// Este archivo lo emite chalc dentro de `.chalc/design/lib/`. No edites aquí: se regenera al equipar el repo.
//
// El perfil es una carpeta temporal propia: no se toca el del usuario, ni sus sesiones, ni sus extensiones. Al
// terminar —bien o mal— el navegador se cierra y la carpeta se borra.

import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findBrowser } from './browser.mjs';
import { createSession } from './cdp.mjs';

const FLAGS = Object.freeze(['--headless=new', '--remote-debugging-pipe', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', '--disable-extensions']);
const EXIT_WAIT_MS = 5000;

// Espera a que el proceso termine, con plazo: un navegador que no muere no cuelga a quien mide.
const exited = (child) => new Promise((resolve) => {
  const timer = setTimeout(resolve, EXIT_WAIT_MS);
  child.once('exit', () => { clearTimeout(timer); resolve(); });
});

/** Lanza el navegador. Devuelve { session, close() }, o null si la máquina no tiene ninguno. */
export async function launchBrowser({ executable = findBrowser() } = {}) {
  if (!executable) return null;
  const profile = await mkdtemp(join(tmpdir(), 'chalc-browser-'));
  // Los descriptores 3 y 4 son la tubería de depuración: por el 3 se le escribe y por el 4 contesta.
  const child = spawn(executable, [...FLAGS, `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], windowsHide: true });
  child.on('error', () => {});
  const session = createSession({ write: (text) => child.stdio[3].write(text), onData: (listener) => child.stdio[4].on('data', listener) });
  return {
    session,
    async close() {
      session.close();
      const gone = exited(child);
      child.kill();
      await gone;
      await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(() => {});
    }
  };
}
