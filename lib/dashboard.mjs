// lib/dashboard.mjs — dashboard de monitoreo de workspaces (spec 006). Responsabilidad única:
// LEER el estado de los workspaces (progreso de tasks.md + git por lado) y servirlo en una página
// local autocontenida. Solo lectura por construcción: únicamente GET, bind a 127.0.0.1, cero
// dependencias (node:http) y ninguna operación que modifique repos ni lance procesos.

import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { t } from './i18n.mjs';
import { c } from './ansi.mjs';
import { git, gitStatus } from './gitprep.mjs';

const BASE_BRANCHES = ['develop', 'main', 'master'];   // candidatas a "base" de la rama de feature

// La lectura de tasks.md (progreso, tarea en curso, texto legible) vive en el catálogo del advisor
// (spec 008, R21): es el mismo código que se emite dentro del repo del usuario, y el dashboard lo
// re-exporta para que no existan dos criterios sobre qué es un checkbox. Mismo patrón que la spec
// 007 con los linters de fronteras y contrato.
// Se importan además de re-exportarse: `export … from` no crea enlaces locales, y este módulo las
// usa al escanear cada lado del workspace.
import { tasksProgress, currentTask, cleanTaskText } from '../catalog/next/lib/tasks.mjs';
import { stripControl } from './termsafe.mjs';
import { POLL_MS, renderPage } from './dashboard/page.mjs';
import { SIDE_NAMES } from './sides.mjs';
export { POLL_MS, renderPage };
export { tasksProgress, currentTask, cleanTaskText };

// Recorte con elipsis para mostrar en columnas (asuntos de commit largos).
const trunc = (s, max) => (String(s ?? '').length > max ? String(s).slice(0, max - 1).trimEnd() + '…' : String(s ?? ''));

// Eventos entre dos refrescos (R12): tarea completada (sube el contador de marcadas → el evento
// nombra la tarea que ESTABA en curso) y commit nuevo. Lados con error no generan eventos. Puro.
export function diffStates(prevWorkspaces, nextWorkspaces) {
  const events = [];
  const prevById = new Map((prevWorkspaces || []).map((w) => [w.id, w]));
  for (const w of nextWorkspaces) {
    const prev = prevById.get(w.id);
    if (!prev) continue;
    const prevSides = new Map(prev.sides.map((s) => [s.name, s]));
    for (const s of w.sides) {
      const p = prevSides.get(s.name);
      if (!p || p.error || s.error) continue;
      if (s.tasks.done > p.tasks.done && p.current) events.push({ id: w.id, side: s.name, type: 'task-done', text: p.current });
      if (s.lastCommit && p.lastCommit !== s.lastCommit) events.push({ id: w.id, side: s.name, type: 'commit', text: s.lastCommit });
    }
  }
  return events;
}

const LOG_MAX = 50;   // eventos retenidos; página y consola muestran los últimos

// Monitor con memoria (R12): en cada tick escanea, compara con el tick anterior y acumula el log
// de actividad. Lo comparten el servidor y la vista de consola (un solo historial por proceso).
export function createMonitor(baseDir, { scanImpl = scanWorkspaces } = {}) {
  let prev = null;
  const log = [];
  return {
    async tick() {
      const workspaces = await scanImpl(baseDir);
      if (prev) {
        for (const ev of diffStates(prev, workspaces)) {
          const stamp = new Date().toTimeString().slice(0, 8);
          const label = ev.type === 'task-done' ? t('dashEvTaskDone', ev.text) : t('dashEvCommit', ev.text);
          log.push(`${stamp}  ${ev.id} · ${ev.side} — ${label}`);
          if (log.length > LOG_MAX) log.shift();
        }
      }
      prev = workspaces;
      return { workspaces, log: [...log] };
    }
  };
}

// Commits de la rama actual sobre su base (primera candidata que exista). Sin base → -1 (la UI muestra '—').
async function commitsOverBase(dir) {
  for (const base of BASE_BRANCHES) {
    if ((await git(['rev-parse', '--verify', '--quiet', base], dir)).code !== 0) continue;
    const count = await git(['rev-list', '--count', `${base}..HEAD`], dir);
    if (count.code === 0) return parseInt(count.out, 10) || 0;
  }
  return -1;
}

// Estado de UN lado del workspace: rama, limpio, commits, último commit y progreso de tareas (R2).
// Lado ilegible (sin git o sin tasks.md de su spec) → { error } y el workspace queda 'broken' (R4).
async function scanSide(dir, side, id) {
  const dest = join(dir, side);
  const status = await gitStatus(dest);
  if (!status.isRepo) return { name: side, error: 'not-a-repo' };
  const tasksFile = join(dest, 'specs', id, 'tasks.md');
  if (!existsSync(tasksFile)) return { name: side, error: 'no-spec' };
  const tasksMd = await readFile(tasksFile, 'utf8');
  return {
    name: side,
    branch: status.branch,
    clean: status.clean,
    commits: await commitsOverBase(dest),
    lastCommit: (await git(['log', '-1', '--format=%s'], dest)).out,
    tasks: tasksProgress(tasksMd),
    // Limpia de markdown pero COMPLETA: el recorte es responsabilidad de cada vista — la
    // consola trunca y la página resume con flecha expandible al texto entero (R2).
    current: cleanTaskText(currentTask(tasksMd), Infinity),
    // En qué punto del ciclo está (R21), solo si el lado trae el advisor: en un repo sin equipar
    // «ask_human» sería ruido, no información.
    ...(existsSync(join(dest, '.chalc', 'next')) ? { next: (await sideAdvice(dest)).action } : {})
  };
}

// El punto del ciclo en que está un lado (spec 008, R21). El progreso dice cuánto lleva; esto dice
// si está escribiendo código, esperando al portón o parado con hallazgos sin arreglar — dos lados
// con el mismo "3/8" pueden estar en situaciones opuestas.
//
// Usa el advisor que trae CHALC (el mismo que emite en cada lado) en vez de reimplementar su tabla, y
// le pasa la raíz del lado: así decide sobre los mismos datos. NO importa el `next.mjs` que hay dentro
// del workspace: eso sería ejecutar código de un repo escaneado desde una vista de solo lectura.
// Nunca lanza: un lado ilegible sale como `ask_human`, que es la respuesta honesta.
const ADVISOR = new URL('../catalog/next/next.mjs', import.meta.url).href;

export async function sideAdvice(dest) {
  try {
    if (!existsSync(join(dest, '.chalc', 'next'))) throw new Error('lado sin advisor emitido');
    const { advise } = await import(ADVISOR);
    const { action, reason } = await advise({ root: dest });
    return { action, reason };
  } catch {
    return { action: 'ask_human', reason: '' };
  }
}

// Estado agregado (R3): solo las tareas deciden (un árbol sucio es lo NORMAL mientras se trabaja).
function aggregateStatus(sides) {
  if (!sides.length || sides.some((s) => s.error)) return 'broken';
  const done = sides.reduce((n, s) => n + s.tasks.done, 0);
  const total = sides.reduce((n, s) => n + s.tasks.total, 0);
  if (total > 0 && done === total) return 'complete';
  if (done === 0) return 'not-started';
  return 'in-progress';
}

// Escanea UN workspace <base>/<id>: sus lados presentes y el estado agregado. Nunca lanza (R4).
export async function scanWorkspace(baseDir, id) {
  const dir = join(baseDir, id);
  const sides = [];
  try {
    for (const side of SIDE_NAMES) {
      if (existsSync(join(dir, side))) sides.push(await scanSide(dir, side, id));
    }
  } catch { /* lado ilegible a mitad de camino: cae al estado broken */ }
  return { id, status: aggregateStatus(sides), sides };
}

// Escanea la carpeta base: solo subcarpetas NNN-slug, en orden (R1). Base inexistente → [].
export async function scanWorkspaces(baseDir) {
  if (!existsSync(baseDir)) return [];
  const dirs = (await readdir(baseDir, { withFileTypes: true }))
    .filter((d) => d.isDirectory() && /^\d{1,4}-/.test(d.name))
    .map((d) => d.name)
    .sort();
  const out = [];
  for (const id of dirs) out.push(await scanWorkspace(baseDir, id));
  return out;
}


// La vista de consola usa la paleta común (respeta NO_COLOR y la salida no-TTY).
const ansi = c;
const STATUS_PAINT = { 'not-started': ansi.dim, 'in-progress': ansi.cyan, complete: ansi.green, broken: ansi.red };

// Barra de progreso en caracteres (mismo dato que la barra de la página).
function textBar(tasks) {
  const filled = tasks.total ? Math.round((10 * tasks.done) / tasks.total) : 0;
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

// Vista VIVA de consola (R10): el MISMO estado que la página, como texto ANSI legible. Por
// workspace: id + estado + rama (una vez, no repetida por lado); por lado: barra, done/total,
// árbol, commits y asunto corto del último commit; debajo, la TAREA EN CURSO (→) ya limpia.
// Al final, el log de actividad (R12). Puro, testeable.
export function renderTerminal(state) {
  const lines = [];
  if (!state.workspaces.length) {
    lines.push(ansi.dim(t('dashEmpty')));
  }
  for (const w of state.workspaces) {
    const paint = STATUS_PAINT[w.status] || ((s) => s);
    const branches = [...new Set(w.sides.filter((s) => !s.error).map((s) => s.branch))];
    lines.push(ansi.bold(stripControl(w.id)) + '  ' + paint(t('dashStatus_' + w.status.replace(/-/g, '_')))
      + (branches.length === 1 ? '  ' + ansi.dim(stripControl(branches[0])) : ''));
    for (const s of w.sides) {
      if (s.error) { lines.push('  ' + ansi.red(stripControl(`${s.name}  ${s.error}`))); continue; }
      const tree = s.clean ? ansi.green(t('dashClean')) : ansi.yellow(t('dashDirty'));
      const commits = s.commits < 0 ? '—' : `↑${s.commits}`;
      const branch = branches.length === 1 ? '' : ` ${stripControl(s.branch)}`;   // solo si difieren entre lados
      lines.push(`  ${stripControl(s.name).padEnd(6)}${branch} ${textBar(s.tasks)} ${s.tasks.done}/${s.tasks.total}  ${tree}  ${commits}  ${ansi.dim(trunc(stripControl(s.lastCommit), 40))}`);
      if (s.current) lines.push('         ' + ansi.cyan('→ ' + trunc(stripControl(s.current), 76)));
      if (s.next) lines.push('         ' + ansi.dim(`${t('dashNext')}: ${stripControl(s.next)}`));
    }
    lines.push('');
  }
  if (state.log?.length) {
    lines.push(ansi.bold(t('dashLogHead')));
    for (const entry of state.log.slice(-8)) lines.push('  ' + ansi.dim(stripControl(entry)));
  }
  return lines.join('\n');
}

// Arranca el servidor (R1, R6, R9): GET / (página) y GET /api/state (JSON, con log de actividad
// R12). Cualquier otro método → 405; otra ruta → 404. Solo 127.0.0.1. `monitor` compartible con
// la vista de consola (un solo historial por proceso). Devuelve { server, url, port }.
export function startDashboard({ baseDir, port = 4321, monitor = createMonitor(baseDir) }) {
  let allowedHosts = new Set();
  const server = createServer(async (req, res) => {
    // DNS rebinding: un dominio ajeno que resuelve a 127.0.0.1 llega con SU nombre en `Host`. Solo se
    // atiende a quien pidió esta máquina por su nombre local, así ninguna web puede leer /api/state.
    if (!allowedHosts.has(String(req.headers.host || '').toLowerCase())) { res.writeHead(403).end(); return; }
    if (req.method !== 'GET') { res.writeHead(405).end(); return; }
    if (req.url === '/api/state') {
      const { workspaces, log } = await monitor.tick();
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ baseDir, generatedAt: new Date().toISOString(), workspaces, log }));
      return;
    }
    if (req.url === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(renderPage({ baseDir, workspaces: [] }));
      return;
    }
    res.writeHead(404).end();
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const real = server.address().port;
      allowedHosts = new Set([`127.0.0.1:${real}`, `localhost:${real}`]);
      resolve({ server, port: real, url: `http://localhost:${real}` });
    });
  });
}
