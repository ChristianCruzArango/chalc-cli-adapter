// lib/dashboard/page.mjs — la página del dashboard (spec 006): autocontenida, sin CDNs ni fetch
// externo. El script de cliente hace polling a /api/state y repinta la tabla sin recargar.

import { t } from '../i18n.mjs';

export const POLL_MS = 5000;   // mismo intervalo para la página y la vista de consola (R5, R10)

// Escapa texto para incrustarlo en HTML (los asuntos de commit son texto libre).
// Incluye las comillas: el mismo `esc` se usa dentro de atributos (`title="…"`, `data-key="…"`), y un
// asunto como `x" onmouseover="…` cerraría el atributo.
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const PAGE_CSS = `  body{font-family:ui-monospace,Consolas,monospace;background:#111;color:#ddd;margin:2rem}
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
`;

// El renderer del navegador. `L` (las etiquetas) se define antes, desde el servidor.
const PAGE_SCRIPT = `const esc = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
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
        + (s.next ? '<tr><td></td><td colspan="5" class="dim">' + esc(L.next) + ': ' + esc(s.next) + '</td></tr>' : '')
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
`;

function pageLabels() {
  return {
    empty: t('dashEmpty'), side: t('dashSideCol'), branch: t('dashBranchCol'), tasks: t('dashTasksCol'),
    tree: t('dashTreeCol'), commits: t('dashCommitsCol'), last: t('dashLastCommitCol'),
    clean: t('dashClean'), dirty: t('dashDirty'), updated: t('dashUpdated'), logHead: t('dashLogHead'), next: t('dashNext'),
    status: {
      'not-started': t('dashStatus_not_started'), 'in-progress': t('dashStatus_in_progress'),
      complete: t('dashStatus_complete'), broken: t('dashStatus_broken')
    }
  };
}

// Página autocontenida (R5, R7, R8): shell + estilos + un renderer inline que hace polling a
// /api/state cada POLL_MS y repinta la tabla — sin recargas completas, sin CDNs, sin fetch externo.
export function renderPage(state) {
  const labels = pageLabels();
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(t('dashTitle'))}</title>
<style>
${PAGE_CSS}</style></head><body>
<h1>⚙️ ${esc(t('dashTitle'))} <span class="dim">${esc(state.baseDir)}</span></h1>
<div id="app" class="dim">…</div>
<p class="dim" id="stamp"></p>
<script>
const L = ${JSON.stringify(labels).replace(/</g, '\\u003c')};
${PAGE_SCRIPT}</script>
</body></html>`;
}
