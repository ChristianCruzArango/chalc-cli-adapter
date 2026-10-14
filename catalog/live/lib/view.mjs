// view.mjs — el modelo del tablero (spec 020, R5, R7). Responsabilidad ÚNICA: ordenar el estado que ya
// calculó el advisor para que se lea de un vistazo: en qué paso va, qué corrió y qué falta. Razón de
// cambio: qué se muestra. Puro: quien lee el disco es el servidor.
//
// Este archivo lo emite chalc dentro de `.chalc/live/lib/`. No edites aquí: se regenera al equipar.
//
// No lee el repo por su cuenta: recibe el `snapshot` y la decisión del advisor, así que el tablero no
// puede contradecir lo que el advisor le dice al agente. Los tokens y el tiempo (R12) llegan del acumulado
// que escribe el hook (`usage`).

import { cleanTaskText, requirementsOf, taskList } from '../../next/lib/tasks.mjs';
import { taskIdOf, ZERO } from './usage.mjs';
import { dashboardOf } from './dashboard.mjs';
import { statusOf } from '../../gate/lib/evidence.mjs';
import { frameOf, messageOf } from '../../gate/lib/i18n.mjs';

// Lo que una tarea despliega de su actividad (R11): lo más reciente.
export const MAX_TASK_ACTIVITY = 40;

const second = (ms) => Math.floor(ms / 1000);
const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : '');

const count = (value) => (Number.isFinite(value) ? value : 0);

// Los tokens de una entrada del acumulado, con su total.
function tokensOf(entry = {}) {
  const tokens = Object.fromEntries(Object.keys(ZERO).map((key) => [key, count(entry[key])]));
  return { ...tokens, total: Object.values(tokens).reduce((a, b) => a + b, 0) };
}

// De la primera acción a la última; un tiempo ilegible o al revés no es una duración.
function durationOf(entry = {}) {
  const ms = Date.parse(entry.lastAt) - Date.parse(entry.firstAt);
  return ms > 0 ? ms : 0;
}

const usageTasks = (usage) => (usage && typeof usage.tasks === 'object' && usage.tasks) || {};

function tasksOf(tasksText, current, usage, activity) {
  const spent = usageTasks(usage);
  return taskList(tasksText).map(({ done, text }) => {
    const id = taskIdOf(text);
    return {
      id, text: cleanTaskText(text, 200), done, current: !done && text === current, requirements: requirementsOf(text),
      tokens: tokensOf(spent[id]), ms: durationOf(spent[id]), startedAt: spent[id]?.firstAt || '',
      activity: activity.filter((a) => a.task === id).slice(0, MAX_TASK_ACTIVITY)
    };
  });
}

// Los totales de la feature: TODO lo consumido —sus tareas y lo que pasó sin tarea en curso (spec, plan)—,
// con eso último también aparte, para que se vea de dónde sale la diferencia.
function totalsOf(tasks, usage) {
  const outside = tokensOf(usageTasks(usage)['']);
  const tokens = { ...outside };
  for (const task of tasks) for (const key of Object.keys(tokens)) tokens[key] += task.tokens[key];
  return { tokens, ms: tasks.reduce((sum, t) => sum + t.ms, 0), outside };
}

// En qué está el agente (R13): trabajando (y qué roles están dentro), esperando tras su turno, o sin datos.
// Cuenta entradas y salidas por rol: dos copias del mismo rol pueden correr a la vez.
function agentOf(newestFirst) {
  const last = newestFirst[0];
  if (!last) return { state: 'none', since: '', inside: [] };
  const open = new Map();
  for (const a of [...newestFirst].reverse()) {
    if (a.kind === 'start') open.set(a.who, (open.get(a.who) || 0) + 1);
    if (a.kind === 'stop') open.set(a.who, (open.get(a.who) || 0) - 1);
    if (a.kind === 'turn-end') open.clear();
  }
  const waiting = last.kind === 'turn-end';
  return { state: waiting ? 'waiting' : 'working', since: last.at || '', inside: [...open].filter(([, n]) => n > 0).map(([who]) => who) };
}

const resultOf = (s) => (s.blocked ? 'blocked' : s.skipped ? 'skipped' : s.ok ? 'passed' : 'failed');

// Un hallazgo del estado, escrito como lo escribe el informe. Lo que no es un hallazgo se descarta.
const detailOf = (lang) => (d) => ({ file: d.file || '', line: d.line || 0, rule: d.rule, detail: messageOf(d.rule, d.data, lang) });

// El portón con las MISMAS palabras que `.chalc/gate.md` (R10, R13): el estado no trae texto, el idioma lo
// pone aquí, con el marco del portón.
function gateOf(state, lang) {
  if (!state) return { verdict: 'none', verdictText: '', date: '', stages: [] };
  const frame = frameOf(lang);
  const verdict = state.verdict || 'none';
  const stages = (state.stages || []).map((s) => ({
    stage: s.stage, title: frame.stages[s.stage] || s.stage, result: resultOf(s), status: statusOf(s, frame), reason: s.reason || '',
    // El porqué a un clic (R10): cuántos hallazgos tuvo y su detalle.
    findings: count(s.findings),
    details: (Array.isArray(s.details) ? s.details : []).filter((d) => d && typeof d === 'object').map(detailOf(lang)),
    ...(typeof s.score === 'number' ? { score: s.score, survivors: s.survivors ?? 0 } : {})
  }));
  return { verdict, verdictText: frame.verdict[verdict] || verdict, date: state.date || '', stages };
}

// Un rol: si su última entrada cubre la evidencia vigente (`ok` / `findings`), si es de antes (`stale`) o si
// nunca revisó (`none`).
function roleOf(role, entries, gateDate) {
  const entry = entries.filter((e) => e.role === role.id).at(-1);
  const base = { id: role.id, cadence: role.cadence, status: 'none', date: '', findings: [], requirements: {}, followups: {} };
  if (!entry) return base;
  const current = !Number.isFinite(gateDate) || second(entry.date) >= second(gateDate);
  return {
    ...base,
    status: !current ? 'stale' : entry.ok ? 'ok' : 'findings',
    date: iso(entry.date),
    findings: entry.items || [],
    requirements: entry.requirements || {},
    followups: entry.followups || {}
  };
}

function activityOf(text) {
  return String(text ?? '').split(/\r?\n/).filter(Boolean)
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean)
    .reverse();
}

/** El modelo de la página a partir de lo que ya sabe el advisor. */
export function viewOf({ snapshot, decision, reason, state, tasksText, activityText, usage, reviewText, specFiles, constitution, harness = '' }) {
  const activity = activityOf(activityText);
  const tasks = tasksOf(tasksText, snapshot.tasks?.current, usage, activity);
  const entries = snapshot.review?.entries || [];
  const roles = (snapshot.flow?.roles || []).filter((r) => r.required !== false)
    .map((r) => roleOf(r, entries, snapshot.gate?.exists ? snapshot.gate.date : NaN));
  const lang = snapshot.lang === 'es' ? 'es' : 'en';
  const view = {
    lang,
    feature: snapshot.tasks?.dir || snapshot.gate?.spec || '',
    progress: { done: snapshot.tasks?.done ?? 0, total: snapshot.tasks?.total ?? 0 },
    tasks,
    next: { action: decision.action, role: decision.facts?.role || '', reason },
    gate: gateOf(state, lang),
    roles,
    missing: { tasks: tasks.filter((t) => !t.done).map((t) => t.text), roles: roles.filter((r) => r.status !== 'ok').map((r) => r.id), next: decision.action },
    totals: totalsOf(tasks, usage),
    agent: agentOf(activity),
    // La actividad y los tokens salen de los hooks de Claude Code (R22). Sin saber el harness, no se niega.
    harness: { target: harness, live: !harness || harness === 'claude' },
    activity
  };
  return { ...view, ...dashboardOf(view, { reviewText, specFiles, constitution: !!constitution, action: decision.action }) };
}
