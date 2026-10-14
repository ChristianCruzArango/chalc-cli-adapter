// server.mjs — el servidor del tablero (spec 020, R1, R3, R5). Responsabilidad ÚNICA: servir la página y el
// estado del repo, solo lectura y solo en local. Razón de cambio: qué se sirve y con qué garantías.
//
// Este archivo lo emite chalc dentro de `.chalc/live/`. Lo lanza `node .chalc/live.mjs` en segundo plano; no
// hace falta invocarlo a mano.
//
// El estado es el del advisor (snapshot + decide + reasonOf): el tablero no lee el repo por su cuenta. Solo
// GET, solo `127.0.0.1`, y además se comprueba la cabecera `Host` —sin eso, una página cualquiera podría
// leer el tablero con un DNS rebinding—. No es un agente: no gasta tokens, solo lee archivos.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REVIEW_REL, snapshot } from '../next/lib/snapshot.mjs';
import { decide } from '../next/lib/decide.mjs';
import { reasonOf } from '../next/lib/i18n.mjs';
import { STATE_REL } from '../gate/lib/evidence.mjs';
import { ACTIVITY_REL } from './lib/activity.mjs';
import { USAGE_REL } from './lib/usage.mjs';
import { hasConstitution, readSpecFiles } from './lib/specfiles.mjs';
import { loadConfig } from '../gate/lib/config.mjs';
import { readProject } from './lib/project.mjs';
import { viewOf } from './lib/view.mjs';
import { pageHtml } from './lib/page.mjs';
import { announce, idleTimer, retire } from './lib/lifecycle.mjs';

export const IDLE_MS = 15 * 60 * 1000;

const textOr = async (path, fallback) => { try { return await readFile(path, 'utf8'); } catch { return fallback; } };
const jsonOr = async (path) => { try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; } };

/** El estado del repo en `root`, listo para la página. */
export async function buildState(root) {
  const s = await snapshot(root);
  const decision = decide(s);
  const { config } = await loadConfig(root);
  const specDir = config.spec?.dir || 'specs';
  // El idioma: el de gate.json; si lo deja vacío, el que se eligió al equipar (R22); si no, inglés.
  const project = await readProject(root);
  const lang = config.language || project.lang || 'en';
  return viewOf({
    snapshot: { ...s, lang }, decision, reason: reasonOf(decision.action, decision.facts, lang),
    state: await jsonOr(join(root, STATE_REL)), tasksText: s.tasks?.text || '', activityText: await textOr(join(root, ACTIVITY_REL), ''),
    usage: await jsonOr(join(root, USAGE_REL)),
    reviewText: await textOr(join(root, REVIEW_REL), ''),
    specFiles: await readSpecFiles(root, specDir), constitution: hasConstitution(root, specDir), harness: project.target
  });
}

const HEADERS = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'"
};

function send(res, status, type, body) {
  res.writeHead(status, { ...HEADERS, 'content-type': `${type}; charset=utf-8` });
  res.end(body);
}

// El 500 de una petición que falló a medias: si ya salieron las cabeceras, solo queda cerrarla.
function failed(res) {
  try { if (res.headersSent) res.end(); else send(res, 500, 'text/plain', 'page unavailable'); } catch { /* conexión ya cerrada */ }
}

// Lo que contesta a UNA petición.
async function answer(req, res, { port, state, root, page }) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'text/plain', 'read-only');
  if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host)) return send(res, 403, 'text/plain', 'forbidden');
  if (req.url !== '/' && req.url !== '/state.json') return send(res, 404, 'text/plain', 'not found');
  let view;
  try { view = await state(root); } catch { return send(res, 500, 'text/plain', 'state unavailable'); }
  return req.url === '/' ? send(res, 200, 'text/html', page(view.lang)) : send(res, 200, 'application/json', JSON.stringify(view));
}

/** Levanta el tablero en un puerto libre de `127.0.0.1`. Devuelve `{ url, close }`. */
export function createLiveServer({ root, idleMs = IDLE_MS, state = buildState, page = pageHtml, onIdle = () => {}, makeIdle = idleTimer }) {
  return new Promise((done) => {
    const idle = makeIdle(idleMs, onIdle);
    // Un fallo al responder (la página que no se arma, una respuesta ya enviada) es un 500 de ESA petición:
    // como rechazo sin atender tumbaría el servidor entero.
    const server = createServer((req, res) => {
      idle.touch();
      answer(req, res, { port: server.address().port, state, root, page }).catch(() => failed(res));
    });
    // La URL sale de la dirección en la que escucha DE VERDAD: si algún día dejara de ser solo local, se vería.
    server.listen(0, '127.0.0.1', () => done({
      url: `http://${server.address().address}:${server.address().port}/`,
      close: () => new Promise((closed) => { idle.stop(); server.close(() => closed()); server.closeAllConnections?.(); })
    }));
  });
}

// Entrada: `node server.mjs <raíz> [minutos]`. La lanza `live.mjs` desacoplada; se anuncia al escuchar y se
// retira y termina cuando pasa el tiempo sin que nadie mire.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv[2] || process.cwd());
  const minutes = Number(process.argv[3]);
  let live;
  live = await createLiveServer({
    root, idleMs: minutes > 0 ? minutes * 60 * 1000 : IDLE_MS,
    onIdle: async () => { await retire(root, process.pid); await live.close(); process.exit(0); }
  });
  await announce(root, { url: live.url, pid: process.pid });
}
