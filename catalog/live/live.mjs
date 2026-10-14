// live.mjs — la entrada del tablero en vivo (spec 020, R1, R2). Responsabilidad ÚNICA: devolver la URL del
// tablero del repo, levantándolo en segundo plano si no hay uno que responda. Razón de cambio: cómo se
// arranca o se reutiliza.
//
// Este archivo lo emite chalc dentro de `.chalc/live/`. Se invoca con `node .chalc/live.mjs` (por ejemplo,
// cuando el usuario le pregunta al agente en qué paso va) y termina enseguida: el servidor queda vivo,
// desacoplado, y se apaga solo cuando nadie lo mira. Imprime SOLO la URL, para que el agente la entregue.

import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAlive, readAnnouncement } from './lib/lifecycle.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// ¿Contesta el tablero en `url`? Un anuncio de un proceso vivo que no contesta no sirve. Se pregunta a la página,
// que no calcula nada: `/state.json` arma el estado del repo (git incluido) y en una máquina lenta pasaba del
// límite, así que un tablero vivo se daba por muerto y se lanzaba otro (visto en la CI de Windows).
export const RESPONDS_TIMEOUT_MS = 3000;
export const responds = (url, timeoutMs = RESPONDS_TIMEOUT_MS) => new Promise((done) => {
  const req = request(url, { timeout: timeoutMs }, (res) => { res.resume(); done(res.statusCode === 200); });
  req.on('timeout', () => { req.destroy(); done(false); });
  req.on('error', () => done(false));
  req.end();
});

// Lanza el servidor desacoplado: no hereda la terminal ni retiene a este proceso.
function launch(root, idleMinutes) {
  const child = spawn(process.execPath, [join(HERE, 'server.mjs'), root, String(idleMinutes || '')], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  return child.pid;
}

/** La URL del tablero de `root`: `{ url, reused }`. Reutiliza uno que vive y contesta; si no, lanza otro. */
export async function startLive(root, { alive = isAlive, responds: answers = responds, launch: start = launch, idleMinutes = 0, pollMs = 100, timeoutMs = 8000 } = {}) {
  const current = await readAnnouncement(root);
  if (current && alive(current.pid) && await answers(current.url)) return { url: current.url, reused: true };

  const pid = await start(root, idleMinutes);
  for (let waited = 0; waited < timeoutMs; waited += pollMs) {
    const announced = await readAnnouncement(root);
    if (announced?.pid === pid) return { url: announced.url, reused: false };
    await sleep(pollMs);
  }
  throw new Error('the board did not start');
}

// Entrada: `node .chalc/live.mjs [--idle <minutos>]`. La raíz es la del proyecto (CLAUDE_PROJECT_DIR) o la carpeta actual.
if (process.argv[1] && /live\.mjs$/.test(process.argv[1])) {
  const at = process.argv.indexOf('--idle');
  try {
    const { url } = await startLive(resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd()), { idleMinutes: at > 0 ? Number(process.argv[at + 1]) : 0 });
    process.stdout.write(`${url}\n`);
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exitCode = 1;
  }
}
