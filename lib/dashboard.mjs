// lib/dashboard.mjs — dashboard de monitoreo de workspaces (spec 006). Responsabilidad única:
// LEER el estado de los workspaces (progreso de tasks.md + git por lado) y servirlo en una página
// local autocontenida. Solo lectura por construcción: únicamente GET, bind a 127.0.0.1, cero
// dependencias (node:http) y ninguna operación que modifique repos ni lance procesos.

import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { t } from './i18n.mjs';
import { git, gitStatus } from './gitprep.mjs';

const SIDE_NAMES = ['back', 'front', 'movil'];   // el layout que deja la spec 005
const BASE_BRANCHES = ['develop', 'main', 'master'];   // candidatas a "base" de la rama de feature
export const POLL_MS = 5000;   // mismo intervalo para la página y la vista de consola (R5, R10)

// Progreso de un tasks.md: checkboxes marcados / totales (listas con - o *). Vacío → 0/0 (R2).
export function tasksProgress(markdown) {
  const boxes = String(markdown ?? '').match(/^\s*[-*]\s*\[[ xX]\]/gm) || [];
  const done = boxes.filter((b) => /\[[xX]\]/.test(b)).length;
  return { done, total: boxes.length };
}

// La tarea EN CURSO: texto de la PRIMERA pendiente del tasks.md (R2). Todo hecho o vacío → ''.
export function currentTask(markdown) {
  const m = String(markdown ?? '').match(/^\s*[-*]\s*\[ \]\s*(.+)$/m);
  return m ? m[1].trim() : '';
}

// Recorte con elipsis para mostrar en columnas (tareas y asuntos de commit largos).
const trunc = (s, max) => (String(s ?? '').length > max ? String(s).slice(0, max - 1).trimEnd() + '…' : String(s ?? ''));

// Limpia el texto de una tarea para MOSTRARLO (R2): fuera marcas markdown (**, `, [P], _…_),
// espacios colapsados y truncado a un largo legible — nunca el párrafo crudo del tasks.md.
export function cleanTaskText(text, max = 76) {
  return trunc(String(text ?? '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/\[P\]\s*/gi, '')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/\s+/g, ' ')
    .trim(), max);
}

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
    current: cleanTaskText(currentTask(tasksMd), Infinity)
  };
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

// Escapa texto para incrustarlo en HTML (los asuntos de commit son texto libre).
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Estilo ANSI mínimo para la vista de consola (mismo criterio que commands/context.mjs; aquí
// local para no invertir la dependencia lib → commands).
const ansi = {
  bold: (s) => `\x1b[1m${s}\x1b[0m`, dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`, cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`, red: (s) => `\x1b[31m${s}\x1b[0m`
};
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
    lines.push(ansi.bold(w.id) + '  ' + paint(t('dashStatus_' + w.status.replace(/-/g, '_')))
      + (branches.length === 1 ? '  ' + ansi.dim(branches[0]) : ''));
    for (const s of w.sides) {
      if (s.error) { lines.push('  ' + ansi.red(`${s.name}  ${s.error}`)); continue; }
      const tree = s.clean ? ansi.green(t('dashClean')) : ansi.yellow(t('dashDirty'));
      const commits = s.commits < 0 ? '—' : `↑${s.commits}`;
      const branch = branches.length === 1 ? '' : ` ${s.branch}`;   // solo si difieren entre lados
      lines.push(`  ${s.name.padEnd(6)}${branch} ${textBar(s.tasks)} ${s.tasks.done}/${s.tasks.total}  ${tree}  ${commits}  ${ansi.dim(trunc(s.lastCommit, 40))}`);
      if (s.current) lines.push('         ' + ansi.cyan('→ ' + trunc(s.current, 76)));
    }
    lines.push('');
  }
  if (state.log?.length) {
    lines.push(ansi.bold(t('dashLogHead')));
    for (const entry of state.log.slice(-8)) lines.push('  ' + ansi.dim(entry));
  }
  return lines.join('\n');
}

// Página autocontenida (R5, R7, R8): shell + estilos + un renderer inline que hace polling a
// /api/state cada POLL_MS y repinta la tabla — sin recargas completas, sin CDNs, sin fetch externo.
export function renderPage(state) {
  const labels = {
    empty: t('dashEmpty'), side: t('dashSideCol'), branch: t('dashBranchCol'), tasks: t('dashTasksCol'),
    tree: t('dashTreeCol'), commits: t('dashCommitsCol'), last: t('dashLastCommitCol'),
    clean: t('dashClean'), dirty: t('dashDirty'), updated: t('dashUpdated'), logHead: t('dashLogHead'),
    status: {
      'not-started': t('dashStatus_not_started'), 'in-progress': t('dashStatus_in_progress'),
      complete: t('dashStatus_complete'), broken: t('dashStatus_broken')
    }
  };
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(t('dashTitle'))}</title>
<style>
  body{font-family:ui-monospace,Consolas,monospace;background:#111;color:#ddd;margin:2rem}
  h1{font-size:1.2rem} .dim{color:#888;font-size:.85rem}
  .ws{border:1px solid #333;border-radius:8px;padding:1rem;margin:1rem 0}
  .ws h2{font-size:1rem;margin:0 0 .5rem 0;display:flex;gap:.6rem;align-items:center}
  .badge{font-size:.75rem;padding:.1rem .5rem;border-radius:99px;border:1px solid}
  .s-not-started{color:#aaa;border-color:#555} .s-in-progress{color:#7cf;border-color:#379}
  .s-complete{color:#8f8;border-color:#4a4} .s-broken{color:#f88;border-color:#a44}
  table{border-collapse:collapse;width:100%} td,th{padding:.25rem .6rem;text-align:left;border-top:1px solid #2a2a2a;font-size:.85rem}
  th{color:#888;font-weight:normal} .bar{background:#2a2a2a;border-radius:4px;height:8px;width:120px;display:inline-block;vertical-align:middle}
  .bar i{display:block;height:8px;border-radius:4px;background:#4a4}
  .dirty{color:#fc6} .clean{color:#8f8}
  .trunc{max-width:34ch;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .task{color:#7cf}
  .task summary{cursor:pointer;outline:none}
  .task .full{padding:.35rem 0 .2rem 1.2rem;color:#9ab;white-space:normal;line-height:1.45}
  .log{border:1px solid #333;border-radius:8px;padding:.6rem 1rem;margin:1rem 0;font-size:.8rem;color:#9a9;max-height:14rem;overflow-y:auto}
  .log div{padding:.1rem 0;border-top:1px dotted #2a2a2a}
</style></head><body>
<h1>⚙️ ${esc(t('dashTitle'))} <span class="dim">${esc(state.baseDir)}</span></h1>
<div id="app" class="dim">…</div>
<p class="dim" id="stamp"></p>
<script>
const L = ${JSON.stringify(labels)};
const esc = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
// Flechas abiertas que deben SOBREVIVIR al repintado de cada refresco (R2): se recuerdan por
// llave workspace/lado y se restauran al reconstruir el HTML. 'toggle' no burbujea → captura.
const openKeys = new Set();
document.addEventListener('toggle', (e) => {
  const k = e.target && e.target.dataset ? e.target.dataset.key : '';
  if (!k) return;
  if (e.target.open) openKeys.add(k); else openKeys.delete(k);
}, true);
// Fila de la tarea en curso: corta → texto plano; larga → resumen con flecha (details) al completo.
function taskRow(key, text){
  const short = text.length > 96 ? text.slice(0, 95).trimEnd() + '…' : text;
  if (short === text) return '<tr><td></td><td colspan="5" class="task">→ ' + esc(text) + '</td></tr>';
  return '<tr><td></td><td colspan="5" class="task"><details data-key="' + esc(key) + '"' + (openKeys.has(key) ? ' open' : '')
    + '><summary>→ ' + esc(short) + '</summary><div class="full">' + esc(text) + '</div></details></td></tr>';
}
function render(state){
  const app = document.getElementById('app');
  if (!state.workspaces.length) { app.textContent = L.empty; return; }
  app.innerHTML = state.workspaces.map((w) => {
    const rows = w.sides.map((s) => s.error
      ? '<tr><td>' + esc(s.name) + '</td><td colspan="5" class="dirty">' + esc(s.error) + '</td></tr>'
      : '<tr><td>' + esc(s.name) + '</td><td>' + esc(s.branch) + '</td>'
        + '<td><span class="bar"><i style="width:' + (s.tasks.total ? Math.round(100*s.tasks.done/s.tasks.total) : 0) + '%"></i></span> '
        + s.tasks.done + '/' + s.tasks.total + '</td>'
        + '<td class="' + (s.clean ? 'clean' : 'dirty') + '">' + (s.clean ? L.clean : L.dirty) + '</td>'
        + '<td>' + (s.commits < 0 ? '—' : s.commits) + '</td><td class="dim trunc" title="' + esc(s.lastCommit || '') + '">' + esc(s.lastCommit || '') + '</td></tr>'
        + (s.current ? taskRow(w.id + '/' + s.name, s.current) : '')
    ).join('');
    return '<div class="ws"><h2>' + esc(w.id) + ' <span class="badge s-' + w.status + '">' + esc(L.status[w.status] || w.status) + '</span></h2>'
      + '<table><tr><th>' + L.side + '</th><th>' + L.branch + '</th><th>' + L.tasks + '</th><th>' + L.tree + '</th><th>' + L.commits + '</th><th>' + L.last + '</th></tr>'
      + rows + '</table></div>';
  }).join('');
  if (state.log && state.log.length) {
    app.innerHTML += '<div class="ws"><h2>' + esc(L.logHead) + '</h2><div class="log">'
      + state.log.slice(-12).reverse().map((l) => '<div>' + esc(l) + '</div>').join('') + '</div></div>';
  }
  document.getElementById('stamp').textContent = L.updated + ' ' + new Date().toLocaleTimeString();
}
async function tick(){
  try { render(await (await fetch('/api/state')).json()); } catch { /* server apagándose */ }
}
tick(); setInterval(tick, ${POLL_MS});
</script>
</body></html>`;
}

// Arranca el servidor (R1, R6, R9): GET / (página) y GET /api/state (JSON, con log de actividad
// R12). Cualquier otro método → 405; otra ruta → 404. Solo 127.0.0.1. `monitor` compartible con
// la vista de consola (un solo historial por proceso). Devuelve { server, url, port }.
export function startDashboard({ baseDir, port = 4321, monitor = createMonitor(baseDir) }) {
  const server = createServer(async (req, res) => {
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
      resolve({ server, port: real, url: `http://localhost:${real}` });
    });
  });
}
