// lib/qaagent.mjs — agente QA: loop plan→ejecutar→juzgar contra una app ya levantada.
// La IA propone UNA acción por turno; la app la ejecuta de forma determinista y se le devuelve la observación.
// El veredicto se ancla en hechos (status HTTP / elemento visible), no en la "impresión" del modelo.

import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chat } from './ai.mjs';
import { createCcrStore, compactObject } from './ccr.mjs';
import { inject, unfence } from './promptkit.mjs';
import { fetchWithTimeout, readLimitedText } from './net.mjs';
import { redactSensitiveText } from './redact.mjs';
import { F, redactObservation } from './qa/common.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROMPT_FILE = join(HERE, 'prompts', 'qa-agent.prompt.xml');


export { redactSensitiveText, redactObservation };


export async function loadAgentPrompt({ surface, baseUrl, plan, observations, language }) {
  const tpl = await readFile(PROMPT_FILE, 'utf8');
  return inject(tpl, {
    LANGUAGE: language || 'español',
    SURFACE: surface || 'api',
    BASE_URL: baseUrl || '',
    PLAN: (plan || '').trim(),
    OBSERVATIONS: (observations || '').trim()
  });
}

// Parsea la respuesta del modelo a objeto. Robusto: quita ``` y toma desde el primer { hasta el último }.
// Lo que no es un OBJETO (`null`, un número, una lista) se rechaza aquí, como el JSON inválido: antes
// llegaba al loop y `message.done` lanzaba un TypeError fuera de todo try/catch.
export function parseAgentMessage(raw) {
  const text = unfence(raw);
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  const value = JSON.parse(first >= 0 && last > first ? text.slice(first, last + 1) : text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('la respuesta del agente no es un objeto JSON');
  return value;
}

function normalizeStatus(status) {
  const upper = String(status || '').toUpperCase();
  return ['PASS', 'FAIL', 'BLOCKED', 'NOT_APPLICABLE'].includes(upper) ? upper : 'BLOCKED';
}

// Garantiza un veredicto por cada R# del spec: los que el modelo no cubrió quedan BLOCKED (no se asume nada).
export function normalizeVerdicts(verdicts, requirementIds = []) {
  const byId = new Map(
    (Array.isArray(verdicts) ? verdicts : [])   // un `verdicts` que no es lista no tumba el agente
      .filter((v) => v && typeof v === 'object' && v.id)
      .map((v) => {
        const id = String(v.id).toUpperCase();
        return [id, { id, status: normalizeStatus(v.status), evidence: redactSensitiveText(v.evidence || '').trim() }];
      })
  );
  const ids = requirementIds.length ? requirementIds.map((s) => String(s).toUpperCase()) : [...byId.keys()];
  return ids.map((id) => byId.get(id) || { id, status: 'BLOCKED', evidence: F().noVerdict });
}

// Construye el bloque de observaciones para el prompt. Con CCR activo, los campos voluminosos se reemplazan
// por referencias; un recall íntegro solo se expone durante el turno inmediato posterior.
function withoutScreenshots(value) {
  if (Array.isArray(value)) return value.map(withoutScreenshots);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !/^screenshotBase64$/i.test(key))
      .map(([key, item]) => [key, withoutScreenshots(item)]));
  }
  return value;
}

function formatObservations(store, list) {
  if (!list.length) return '(sin observaciones todavía)';
  return list
    .map((r) => {
      const safeObservation = withoutScreenshots(r.observation);
      const obs = store && !r.expandedPending ? compactObject(store, safeObservation) : safeObservation;
      return `Paso ${r.step}: ${r.thought}\n  acción: ${JSON.stringify(r.action)}\n  resultado: ${JSON.stringify(obs)}`;
    })
    .join('\n');
}

function consumeExpandedObservations(list) {
  for (const record of list) if (record.expandedPending) record.expandedPending = false;
}

// Executor HTTP determinista: ejecuta una acción {type:'http',...} contra baseUrl y devuelve hechos observables.
// fetch es inyectable para testear sin red. `ok` se decide por el status esperado (o 2xx/3xx por defecto).
// Por defecto con plazo para toda la respuesta (cuerpo incluido) y lectura acotada.
const HTTP_TIMEOUT_MS = 30000;
const HTTP_MAX_BYTES = 4 * 1024 * 1024;
const timedFetch = (url, init) => fetchWithTimeout(url, { ...init, timeoutMs: HTTP_TIMEOUT_MS });

// La URL final de una acción, o null si saldría del origen de la app.
function qaTarget(base, path) {
  try {
    const origin = new URL(`${base}/`);
    const url = new URL(`${origin.pathname.replace(/\/$/, '')}${path}`, origin);
    return url.origin === origin.origin ? url : null;
  } catch { return null; }
}

// `/api` cubre `/api` y `/api/...`, no `/apiadmin`.
const underPrefix = (pathname, prefix) => {
  const p = String(prefix).replace(/\/+$/, '') || '/';
  return p === '/' || pathname === p || pathname.startsWith(`${p}/`);
};

export function httpExecutor(baseUrl, { fetchImpl = timedFetch, allowedMethods = ['GET', 'HEAD', 'OPTIONS'], allowedPaths = [], headers = {} } = {}) {
  const base = String(baseUrl || '').replace(/\/$/, '');
  // Las observaciones van en inglés: son para el modelo, como las de cualquier otra herramienta.
  return async (action) => {
    if (!action || action.type !== 'http') return { ok: false, error: `action not supported on the api surface: ${action?.type}` };
    const raw = action.path?.startsWith('/') ? action.path : '/' + (action.path || '');
    const method = String(action.method || 'GET').toUpperCase();
    const request = `${method} ${raw}`;
    if (!allowedMethods.includes(method)) return { ok: false, error: `method ${method} not allowed by the QA policy`, request };
    // La ruta se normaliza COMO LO HARÁ fetch antes de comprobarla: `/api/../admin` (o `%2e%2e`) pasaba
    // el `startsWith('/api')` y luego viajaba como `/admin`. Y no puede cambiar de origen (`//otro.host`).
    const target = qaTarget(base, raw);
    if (!target) return { ok: false, error: `path not allowed by the QA policy: ${raw}`, request };
    if (allowedPaths.length && !allowedPaths.some((prefix) => underPrefix(target.pathname, prefix))) return { ok: false, error: `path not allowed by the QA policy: ${target.pathname}`, request };
    try {
      const res = await fetchImpl(target.href, {
        method,
        // La sesión inyectada (auth) va DESPUÉS: gana sobre los headers de la acción. Sin esto, el modelo
        // —que no sabe que ya hay sesión— manda un Authorization propio malformado y pisa el token válido,
        // haciendo fallar con 401 toda verificación de endpoints protegidos (visto contra el micro SICEP).
        headers: { ...(action.headers || {}), ...headers },
        body: action.body != null ? JSON.stringify(action.body) : undefined
      });
      let body = '';
      try { body = await readLimitedText(res, HTTP_MAX_BYTES); } catch { /* sin cuerpo legible o demasiado grande */ }
      const expected = action.expect?.status ?? null;
      const ok = expected != null ? res.status === expected : res.status >= 200 && res.status < 400;
      // No se trunca antes de CCR: una referencia viva siempre puede recuperar la evidencia completa.
      return { ok, status: res.status, expected, body: redactSensitiveText(body), request };
    } catch (e) {
      return { ok: false, error: String(e?.message || e), request };
    }
  };
}

// El agente debe conocer su presupuesto: si no, explora sin converger. En el último paso se exige el veredicto.
function budgetPrompt(left) {
  return left <= 0
    ? 'ÚLTIMO PASO: no ejecutes más acciones. Emite YA el veredicto final {"done":true,"verdicts":[...]} para TODOS los R#, usando BLOCKED donde no obtuviste evidencia.'
    : `Decide el siguiente paso. Te quedan ${left} pasos; en cuanto no puedas obtener más evidencia, emite el veredicto final cubriendo todos los R#.`;
}

// recall: el agente pide expandir una referencia CCR. Se sirve desde la caché, sin ejecutar nada externo.
function recallObservation(store, action) {
  const original = store ? store.recall(action.ref) : null;
  return original != null
    ? { recall: action.ref, content: original }
    : { recall: action?.ref, error: 'CCR reference expired or unknown' };
}

// Loop del agente. chatImpl y executor son inyectables: con un chat simulado se testea sin gastar tokens.
// ccr: un store de createCcrStore() para compresión reversible (default), o false para desactivarla.
export async function runQaAgent(opts) {
  const {
    cfg, surface, baseUrl, plan, requirementIds = [], executor,
    chatImpl = chat, maxSteps = 8, maxTokens = 2000, language, onStep, ccr
  } = opts;
  if (typeof executor !== 'function') throw new Error('runQaAgent requiere un executor.');
  const store = ccr === false ? null : (ccr && typeof ccr.compact === 'function' ? ccr : createCcrStore());
  const observations = [];
  const finish = (verdicts, error) => ({ verdicts: normalizeVerdicts(verdicts, requirementIds), steps: observations, ccr: store?.stats() || null, ...(error ? { error } : {}) });

  for (let step = 1; step <= maxSteps; step++) {
    const system = await loadAgentPrompt({ surface, baseUrl, plan, observations: formatObservations(store, observations), language });
    consumeExpandedObservations(observations);
    const raw = await chatImpl(cfg, { system, user: budgetPrompt(maxSteps - step), json: true, maxTokens });

    let message;
    try { message = parseAgentMessage(raw); }
    catch { return finish([], F().invalidJson); }

    if (message.done) return finish(message.verdicts);

    const recall = message.action?.type === 'recall';
    const observation = recall ? recallObservation(store, message.action) : redactObservation(await executor(message.action));
    const record = { step, thought: message.thought || '', action: message.action, observation, ...(recall ? { expandedPending: true } : {}) };
    observations.push(record);
    if (onStep) onStep(record);
  }

  return finish([], F().stepsExhausted(maxSteps));
}

export { buildResultsMarkdown, buildRepairPlanMarkdown, parseResultsMarkdown } from './qa/results.mjs';
export { buildAgentReplaySpec, authRoute, seedStorage, createBrowserExecutor } from './qa/browser.mjs';
