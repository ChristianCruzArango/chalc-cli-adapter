// page-script.mjs — el script que corre en el navegador del tablero (spec 020, R5, R6, R10–R13, R17–R20).
// Responsabilidad ÚNICA: pedir `/state.json` y repintar cada sección. Razón de cambio: cómo se pinta el estado.
//
// Este archivo lo emite chalc dentro de `.chalc/live/lib/`. No edites aquí: se regenera al equipar.
//
// Todo lo que pinta sale de archivos del repo (tareas, hallazgos, notas, comandos), así que crea nodos y pone
// el texto con `textContent`, NUNCA como HTML: una nota que diga `<script>` se lee, no se ejecuta. Lo que el
// usuario abre (una tarea, una etapa, una nota) se recuerda en `opened`, para que el refresco no lo cierre.

import { agoText, durationText, tokensText } from './format.mjs';

const CLIENT = String.raw`
const $ = (id) => document.getElementById(id);
const opened = new Map();
let last = '';
let lastView = null;
function el(tag, cls, text, kids) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = String(text);
  for (const k of kids || []) if (k) n.append(k);
  return n;
}
// replaceChildren pinta un null como el texto «null»: se filtra siempre.
function fill(id, title, kids) { $(id).replaceChildren(el('h2', '', title), ...kids.filter(Boolean)); }
const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString(LANG) : '');
const tok = (n) => tokensText(n, LANG);
const dur = (ms) => durationText(ms, L.words);
const pct = (a, b) => (b ? Math.round(100 * a / b) : 0);
// Sin hooks de Claude Code no hay actividad ni tokens: se dice para qué harness está equipado (R22).
const noLive = (v) => L.words.noLiveHarness.replace('{harness}', L.harness[v.harness.target] || v.harness.target);
const count = (n, one, many) => n + ' ' + (n === 1 ? one : many);
function fold(key, startOpen, summaryKids, bodyKids, cls) {
  const d = el('details', cls || '');
  d.open = opened.has(key) ? opened.get(key) : startOpen;
  d.addEventListener('toggle', () => opened.set(key, d.open));
  d.append(el('summary', '', undefined, summaryKids), el('div', 'body', undefined, bodyKids));
  return d;
}
function bar(percent, cls) { const b = el('div', 'bar ' + (cls || '')); const i = el('i'); i.style.width = Math.max(0, Math.min(100, percent)) + '%'; b.append(i); return b; }
function stat(label, value, title) { const n = el('div', 'stat', undefined, [el('div', 'label', label), el('div', 'value', value)]); if (title !== undefined) n.title = String(title); return n; }
function agentChip(v) {
  const a = v.agent;
  const chip = $('agent');
  chip.replaceChildren(...[el('span', 'dot ' + a.state), el('b', '', L.agent[a.state]), a.since ? el('span', 'mute', agoText(a.since, Date.now(), L.words)) : null,
    a.inside.length ? el('span', 'pill role', a.inside.join(', ') + ' ' + L.agent.inside) : null].filter(Boolean));
  chip.className = 'chip ' + a.state;
  chip.title = v.harness.live ? L.agent[a.state + 'Hint'] : noLive(v);
}
// La frase titular: en qué tarea va, cómo quedó el portón (y qué falla) y qué sigue. Cada parte con su color.
function headlineText(h) {
  const task = h.task ? L.words.task + ' ' + h.task + ' (' + h.index + ' ' + L.words.of + ' ' + h.total + ')' : L.words.noTaskNow;
  const list = (xs) => (xs.length > 1 ? xs.slice(0, -1).join(', ') + ' ' + L.words.and + ' ' + xs.at(-1) : xs.join(''));
  const gateText = h.verdict === 'none' ? L.words.noGateYet : L.words.gateWord + ' ' + h.verdictText + (h.failing.length ? ' ' + L.words.by + ' ' + list(h.failing) : '');
  return [el('span', '', task), el('span', 'sep', ' · '), el('span', 'v-' + h.verdict, gateText), el('span', 'sep', ' · '),
    el('span', 'next', L.words.next + ': ' + (L.actions[h.action] || h.action) + (h.role ? ' (' + h.role + ')' : ''))];
}
function headline(v) {
  const k = v.kpis;
  fill('headline', L.sections.headline, [el('p', 'headline', undefined, headlineText(v.headline)), el('p', 'mute reason', v.next.reason),
    el('div', 'figures', undefined, [figure(L.kpi.progress, k.tasks.done + '/' + k.tasks.total, bar(pct(k.tasks.done, k.tasks.total))),
      figure(L.kpi.tokens, tok(k.tokens), v.totals.outside.total ? el('div', 'mute small', L.words.outside + ': ' + tok(v.totals.outside.total)) : null),
      figure(L.kpi.time, dur(k.ms)), figure(L.kpi.roles, k.roles.ok + '/' + k.roles.total)])]);
}
function figure(label, value, extra) { return el('div', 'figure', undefined, [el('div', 'label', label), el('div', 'value', value), extra || null]); }
function phaseDetail(p) {
  const d = p.detail;
  if (!d) return '';
  if (d.text) return d.text;
  if (d.n !== undefined) return p.id === 'spec' ? count(d.n, L.words.requirementOne, L.words.requirementsN) : count(d.n, L.words.taskOne, L.words.tasksN);
  return d.done + ' ' + L.words.of + ' ' + d.total;
}
// La vía de estaciones del método: cada fase es una estación; la que está en curso lleva el marcador.
function flow(v) {
  fill('flow', L.sections.flow, [el('ol', 'rail', undefined, v.flow.map((p, i) => el('li', 'station ' + p.state, undefined, [
    el('span', 'node', p.state === 'done' ? '✓' : p.state === 'failed' ? '✗' : String(i + 1)), el('div', 'name', L.phases[p.id]),
    el('div', 'meta', L.phase[p.state] + (phaseDetail(p) ? ' · ' + phaseDetail(p) : ''))])))]);
}
function charts(v) {
  if (!v.tasks.length) return fill('charts', L.sections.charts, [el('div', 'mute', L.words.noTasks)]);
  if (!v.totals.tokens.total && !v.totals.ms) return fill('charts', L.sections.charts, [el('div', 'mute', v.harness.live ? L.words.noUsage : noLive(v))]);
  const max = Math.max(1, ...v.tasks.map((t) => t.tokens.total));
  const maxMs = Math.max(1, ...v.tasks.map((t) => t.ms));
  fill('charts', L.sections.charts, v.tasks.map((t) => el('div', 'bar-row', undefined, [el('span', 'tid', t.id),
    el('div', 'bars', undefined, [bar(pct(t.tokens.total, max), 'tokens'), bar(pct(t.ms, maxMs), 'time')]),
    el('span', 'num', tok(t.tokens.total)), el('span', 'num mute', dur(t.ms))])).concat([el('div', 'legend small mute', undefined, [el('span', 'sw tokens'), el('span', '', L.kpi.tokens), el('span', 'sw time'), el('span', '', L.kpi.time)])]));
}
// El portón: su veredicto como sello, las etapas en un carril y el porqué de la elegida en un panel al lado.
let selectedStage = '';
const stageMark = (s) => (s.result === 'passed' ? '✓' : s.result === 'skipped' ? '–' : '✗');
function stagePanel(s) {
  if (!s) return el('div', 'stage-panel mute', L.words.pickStage);
  const score = s.score !== undefined ? L.words.score + ' ' + s.score + '% · ' + s.survivors + ' ' + L.words.survivors : '';
  const rows = s.details.map((d) => el('li', '', undefined, [el('div', '', d.detail), el('div', 'mute small mono', [d.file && d.file + (d.line ? ':' + d.line : ''), L.words.rule + ': ' + d.rule].filter(Boolean).join(' · '))]));
  return el('div', 'stage-panel ' + s.result, undefined, [el('div', 'label', L.words.detail), el('div', 'panel-title', stageMark(s) + ' ' + s.title + ' — ' + s.status), score ? el('div', 'small', score) : null,
    rows.length ? el('div', 'label', L.words.why) : el('div', 'mute', L.words.noDetails), rows.length ? el('ul', 'why', undefined, rows) : null,
    s.findings > s.details.length ? el('div', 'mute small', (s.findings - s.details.length) + ' ' + L.words.more) : null]);
}
function stageButton(s, chosen) {
  const b = el('button', 'stage-btn ' + s.result + (chosen ? ' chosen' : ''), undefined, [el('span', 'mark', stageMark(s)), el('span', '', s.title),
    s.findings ? el('span', 'count', String(s.findings)) : null]);
  b.type = 'button';
  b.title = s.status;
  b.addEventListener('click', () => { selectedStage = s.stage; gate(lastView); });
  return b;
}
function gate(v) {
  if (!v.gate.stages.length) return fill('gate', L.sections.gate, [el('div', 'mute', L.words.noGate)]);
  const failing = v.gate.stages.find((s) => s.result === 'failed' || s.result === 'blocked');
  const chosen = v.gate.stages.find((s) => s.stage === selectedStage) || failing || v.gate.stages[0];
  fill('gate', L.sections.gate, [el('div', 'gate-head', undefined, [el('span', 'stamp v-' + v.gate.verdict, v.gate.verdictText), el('span', 'mute small', clock(v.gate.date))]),
    el('div', 'gate-body', undefined, [el('div', 'stage-lane', undefined, v.gate.stages.map((s) => stageButton(s, s === chosen))), stagePanel(chosen)])]);
}
function activityRow(a) {
  const who = a.who === 'principal' ? L.words.principal : a.who;
  return el('div', 'row', undefined, [el('span', 'time', clock(a.at)), el('span', 'who', who), el('span', 'what', a.kind === 'tool' ? a.tool : L.words[a.kind] || a.kind),
    el('code', 'mute', a.summary || ''), el('span', 'pill', a.task || L.words.noTask)]);
}
function tokenGrid(t) {
  return el('div', 'stats', undefined, [stat(L.words.input, tok(t.input), t.input), stat(L.words.output, tok(t.output), t.output),
    stat(L.words.cacheRead, tok(t.cacheRead), t.cacheRead), stat(L.words.cacheWrite, tok(t.cacheWrite), t.cacheWrite), stat(L.words.total, tok(t.total), t.total)]);
}
function taskItem(t) {
  const state = t.done ? 'done' : t.current ? 'current' : 'pending';
  const head = [el('span', 'mark ' + state, t.done ? '✓' : t.current ? '▶' : '○'), el('span', 'ttext', t.text), el('span', 'pill ' + state, L.task[state]),
    el('span', 'pill', tok(t.tokens.total) + ' ' + L.words.tokens), el('span', 'pill', dur(t.ms))];
  const body = [el('div', 'label', L.words.requirements), el('div', '', t.requirements.length ? t.requirements.join(', ') : L.words.noRequirements),
    t.tokens.total ? tokenGrid(t.tokens) : el('div', 'mute small', L.words.noTaskTokens),
    t.startedAt ? el('div', 'mute small', L.words.started + ': ' + new Date(t.startedAt).toLocaleString(LANG) + ' · ' + L.words.time + ': ' + dur(t.ms)) : null,
    el('div', 'label', L.words.taskActivity), t.activity.length ? el('div', 'rows', undefined, t.activity.map(activityRow)) : el('div', 'mute', L.words.noTaskActivity)];
  return fold('task:' + t.id, t.current, head, body, 'task ' + state);
}
function tasks(v) { fill('tasks', L.sections.tasks, v.tasks.length ? [el('div', 'mute small', L.words.hint), ...v.tasks.map(taskItem)] : [el('div', 'mute', L.words.noTasks)]); }
// Una pasada de un rol, como anotación al margen: quién, cuándo, en qué tarea y cada línea con su marca.
function noteItem(n, i) {
  const verdict = n.ok ? L.status.ok : n.findings + ' ' + (n.findings === 1 ? L.words.findingOne : L.words.findingMany);
  const head = [el('span', 'pen', '✎'), el('b', 'role', n.role), el('span', 'pill ' + (n.ok ? 'ok' : 'findings'), verdict), n.task ? el('span', 'pill', n.task) : null,
    el('span', 'mute small', new Date(n.at).toLocaleString(LANG)), el('code', 'mute small', n.commit)];
  const lines = n.lines.map((l) => el('li', 'note-line', undefined, [el('span', 'pill m-' + l.mark, L.marks[l.mark]), el('span', '', l.text)]));
  return fold('note:' + n.role + n.at, i === 0 || !n.ok, head, lines.length ? [el('ul', 'note-lines', undefined, lines)] : [], 'margin-note ' + (n.ok ? 'ok' : 'findings'));
}
function notes(v) {
  const chips = el('div', 'role-chips', undefined, v.roles.map((r) => el('span', 'pill ' + r.status, r.id + ' · ' + L.status[r.status])));
  fill('notes', L.sections.notes, [chips, ...(v.notes.length ? v.notes.map(noteItem) : [el('div', 'mute', L.words.noNotes)])]);
}
function missing(v) {
  const kids = [];
  if (v.missing.tasks.length) kids.push(el('div', 'label', L.words.pendingTasks), el('ul', '', undefined, v.missing.tasks.map((t) => el('li', '', t))));
  if (v.missing.roles.length) kids.push(el('div', 'label', L.words.pendingRoles), el('div', '', v.missing.roles.join(', ')));
  if (!kids.length) kids.push(el('div', 'ok', L.words.nothingMissing));
  kids.push(el('div', 'mute small', L.words.nextStep + ': ' + (L.actions[v.missing.next] || v.missing.next)));
  fill('missing', L.sections.missing, kids);
}
// Las specs del proyecto, en la barra lateral: la vigente marcada, cada una con su avance.
function specs(v) {
  const box = $('specs');
  box.replaceChildren(...[el('div', 'label', L.sections.specs), ...(v.specs.length ? v.specs.map((s) => el('div', 'spec' + (s.current ? ' current' : ''), undefined, [
    el('div', 'spec-name', s.name), s.title !== s.name ? el('div', 'mute small', s.title) : null,
    el('div', 'mute small', count(s.requirements, L.words.requirementOne, L.words.requirementsN) + ' · ' + (s.plan ? L.words.plan + ' ✓' : L.words.noPlan) + ' · ' + s.tasks.done + '/' + s.tasks.total),
    bar(pct(s.tasks.done, s.tasks.total))])) : [el('div', 'mute small', L.words.noSpecs)])].filter(Boolean));
}
function activity(v) {
  fill('activity', L.sections.activity, v.activity.length ? [el('div', 'rows', undefined, v.activity.map(activityRow))] : [el('div', 'mute', v.harness.live ? L.words.noActivity : noLive(v))]);
}
function render(v) { agentChip(v); specs(v); headline(v); flow(v); gate(v); charts(v); missing(v); tasks(v); notes(v); activity(v); }
async function tick() {
  try {
    const text = await (await fetch('/state.json', { cache: 'no-store' })).text();
    // Solo se repinta si algo cambió: así no se mueve lo que el usuario está leyendo o seleccionando.
    if (text !== last) { last = text; lastView = JSON.parse(text); render(lastView); } else if (lastView) agentChip(lastView);
    $('updated').textContent = L.words.updated + ' ' + new Date().toLocaleTimeString(LANG);
  } catch { $('updated').textContent = L.words.offline; }
}`;

/** El script del navegador con sus textos, su idioma, los formateadores y el intervalo de refresco. */
export function clientScript(labels, lang, refreshMs) {
  return [`const L = ${JSON.stringify(labels)};`, `const LANG = ${JSON.stringify(lang)};`,
    durationText.toString(), tokensText.toString(), agoText.toString(), CLIENT, `tick(); setInterval(tick, ${refreshMs});`].join('\n');
}
