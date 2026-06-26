// lib/qaagent.mjs — agente QA: loop plan→ejecutar→juzgar contra una app ya levantada.
// La IA propone UNA acción por turno; la app la ejecuta de forma determinista y se le devuelve la observación.
// El veredicto se ancla en hechos (status HTTP / elemento visible), no en la "impresión" del modelo.

import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chat } from './ai.mjs';
import { createCcrStore, compactObject } from './ccr.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROMPT_FILE = join(HERE, 'prompts', 'qa-agent.prompt.xml');

// Inyecta ${VAR} validando que todas estén resueltas (regla #9 del estándar de prompts).
function inject(template, vars) {
  return template.replace(/\$\{(\w+)\}/g, (_, key) => {
    if (!(key in vars)) throw new Error(`Falta variable de prompt: ${key}`);
    return vars[key];
  });
}

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
export function parseAgentMessage(raw) {
  let text = String(raw || '').trim();
  if (text.startsWith('```')) text = text.replace(/^```[\w-]*\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) text = text.slice(first, last + 1);
  return JSON.parse(text);
}

function normalizeStatus(status) {
  const upper = String(status || '').toUpperCase();
  return ['PASS', 'FAIL', 'BLOCKED', 'NOT_APPLICABLE'].includes(upper) ? upper : 'BLOCKED';
}

// Garantiza un veredicto por cada R# del spec: los que el modelo no cubrió quedan BLOCKED (no se asume nada).
export function normalizeVerdicts(verdicts, requirementIds = []) {
  const byId = new Map(
    (verdicts || [])
      .filter((v) => v && v.id)
      .map((v) => {
        const id = String(v.id).toUpperCase();
        return [id, { id, status: normalizeStatus(v.status), evidence: String(v.evidence || '').trim() }];
      })
  );
  const ids = requirementIds.length ? requirementIds.map((s) => String(s).toUpperCase()) : [...byId.keys()];
  return ids.map((id) => byId.get(id) || { id, status: 'BLOCKED', evidence: 'El agente no emitió veredicto para este requisito.' });
}

// Construye el bloque de observaciones para el prompt. Con CCR activo, los campos voluminosos se reemplazan
// por referencias; un recall íntegro solo se expone durante el turno inmediato posterior.
function formatObservations(store, list) {
  if (!list.length) return '(sin observaciones todavía)';
  return list
    .map((r) => {
      const obs = store && !r.expandedPending ? compactObject(store, r.observation) : r.observation;
      return `Paso ${r.step}: ${r.thought}\n  acción: ${JSON.stringify(r.action)}\n  resultado: ${JSON.stringify(obs)}`;
    })
    .join('\n');
}

function consumeExpandedObservations(list) {
  for (const record of list) if (record.expandedPending) record.expandedPending = false;
}

// Executor HTTP determinista: ejecuta una acción {type:'http',...} contra baseUrl y devuelve hechos observables.
// fetch es inyectable para testear sin red. `ok` se decide por el status esperado (o 2xx/3xx por defecto).
export function httpExecutor(baseUrl, { fetchImpl = fetch, allowedMethods = ['GET', 'HEAD', 'OPTIONS'], allowedPaths = [], headers = {} } = {}) {
  const base = String(baseUrl || '').replace(/\/$/, '');
  return async (action) => {
    if (!action || action.type !== 'http') return { ok: false, error: `acción no soportada en api: ${action?.type}` };
    const path = action.path?.startsWith('/') ? action.path : '/' + (action.path || '');
    const method = String(action.method || 'GET').toUpperCase();
    const request = `${method} ${path}`;
    if (!allowedMethods.includes(method)) return { ok: false, error: `método ${method} no autorizado por la política QA`, request };
    if (allowedPaths.length && !allowedPaths.some((prefix) => path.startsWith(prefix))) return { ok: false, error: `ruta no autorizada por la política QA: ${path}`, request };
    try {
      const res = await fetchImpl(base + path, {
        method,
        headers: { ...headers, ...(action.headers || {}) },   // sesión base (auth) + headers de la acción
        body: action.body != null ? JSON.stringify(action.body) : undefined
      });
      let body = '';
      try { body = await res.text(); } catch { /* sin cuerpo legible */ }
      const expected = action.expect?.status ?? null;
      const ok = expected != null ? res.status === expected : res.status >= 200 && res.status < 400;
      // No se trunca antes de CCR: una referencia viva siempre puede recuperar la evidencia completa.
      return { ok, status: res.status, expected, body, request };
    } catch (e) {
      return { ok: false, error: String(e?.message || e), request };
    }
  };
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
    // El agente debe conocer su presupuesto: si no, explora sin converger. En el último paso se exige el veredicto.
    const left = maxSteps - step;
    const user = left <= 0
      ? 'ÚLTIMO PASO: no ejecutes más acciones. Emite YA el veredicto final {"done":true,"verdicts":[...]} para TODOS los R#, usando BLOCKED donde no obtuviste evidencia.'
      : `Decide el siguiente paso. Te quedan ${left} pasos; en cuanto no puedas obtener más evidencia, emite el veredicto final cubriendo todos los R#.`;
    const raw = await chatImpl(cfg, { system, user, json: true, maxTokens });

    let message;
    try { message = parseAgentMessage(raw); }
    catch { return finish([], 'El agente devolvió un JSON inválido.'); }

    if (message.done) return finish(message.verdicts);

    // recall: el agente pide expandir una referencia CCR. Se sirve desde la caché, sin ejecutar nada externo.
    if (message.action?.type === 'recall') {
      const original = store ? store.recall(message.action.ref) : null;
      const observation = original != null
        ? { recall: message.action.ref, content: original }
        : { recall: message.action?.ref, error: 'referencia CCR expirada o desconocida' };
      const record = { step, thought: message.thought || '', action: message.action, observation, expandedPending: true };
      observations.push(record);
      if (onStep) onStep(record);
      continue;
    }

    const observation = await executor(message.action);
    const record = { step, thought: message.thought || '', action: message.action, observation };
    observations.push(record);
    if (onStep) onStep(record);
  }

  return finish([], `Se agotaron los ${maxSteps} pasos sin veredicto.`);
}

// Reporte trazable: una fila por R# con su veredicto y la evidencia observada.
export function buildResultsMarkdown(specId, { surface, baseUrl, result, evidencePaths = [] }) {
  const header = [
    `# Resultados QA — ${specId}`,
    '',
    `- Superficie: **${surface}**`,
    `- Base URL: ${baseUrl}`,
    `- Pasos ejecutados: ${result.steps?.length ?? 0}`
  ];
  if (result.ccr) header.push(`- CCR (compresión reversible): ${result.ccr.entries} referencias, ~${result.ccr.charsSaved} caracteres diferidos`);
  if (result.error) header.push(`- Nota: ${result.error}`);
  if (evidencePaths.length) header.push(`- Evidencias: ${evidencePaths.map((p) => `\`${p}\``).join(', ')}`);
  const table = [
    '',
    '| Requisito | Estado | Evidencia |',
    '|---|---|---|',
    ...result.verdicts.map((v) => `| ${v.id} | ${v.status} | ${String(v.evidence || '').replaceAll('|', '\\|')} |`),
    ''
  ];
  return [...header, ...table].join('\n');
}

export function buildRepairPlanMarkdown(specId, { result, requirementTexts = {}, generatedAt = new Date().toISOString() }) {
  const actionable = (result?.verdicts || []).filter((v) => ['FAIL', 'BLOCKED'].includes(v.status));
  const lines = [
    `# Plan de reparación — ${specId}`,
    '',
    `- Generado: ${generatedAt}`,
    `- Fuente: \`qa/results.md\``,
    '',
    '## Alcance',
    '',
    actionable.length
      ? 'Corregir solo los requisitos con evidencia FAIL/BLOCKED. No cambiar requisitos PASS salvo que una corrección lo exija.'
      : 'No hay requisitos FAIL/BLOCKED en el último resultado QA.',
    '',
    '## Tareas',
    ''
  ];
  if (!actionable.length) {
    lines.push('- [ ] Mantener monitoreo; no se requiere reparación funcional.');
    return lines.join('\n') + '\n';
  }
  for (const item of actionable) {
    const text = requirementTexts[item.id] ? ` — ${requirementTexts[item.id]}` : '';
    lines.push(
      `- [ ] ${item.id}${text}`,
      `  - Estado QA: ${item.status}`,
      `  - Evidencia: ${String(item.evidence || 'Sin evidencia registrada.').replace(/\s+/g, ' ').trim()}`,
      '  - Escribir o ajustar una prueba que reproduzca esta evidencia.',
      '  - Implementar la mínima corrección necesaria.',
      '  - Reejecutar `chalc qa ... --agent` y confirmar que el requisito pasa.'
    );
  }
  return lines.join('\n') + '\n';
}

export function parseResultsMarkdown(markdown) {
  const verdicts = [];
  for (const line of String(markdown || '').split(/\r?\n/)) {
    const m = line.match(/^\|\s*(R\d+)\s*\|\s*(PASS|FAIL|BLOCKED|NOT_APPLICABLE)\s*\|\s*(.*?)\s*\|$/i);
    if (!m) continue;
    verdicts.push({ id: m[1].toUpperCase(), status: m[2].toUpperCase(), evidence: m[3].replace(/\\\|/g, '|').trim() });
  }
  return { verdicts, steps: [] };
}

// Traduce un paso de navegador del agente a una línea de Playwright. URLs absolutas: sin playwright.config.
function playwrightLine(base, stp) {
  switch (stp.op) {
    case 'goto': return `await page.goto(${JSON.stringify(base + (stp.url?.startsWith('/') ? stp.url : '/' + (stp.url || '')))});`;
    case 'fill': return `await page.fill(${JSON.stringify(stp.selector)}, ${JSON.stringify(stp.value ?? '')});`;
    case 'fillByLabel': return `await page.getByLabel(${JSON.stringify(stp.label)}).fill(${JSON.stringify(stp.value ?? '')});`;
    case 'click': return `await page.click(${JSON.stringify(stp.selector)});`;
    case 'clickByRole': return `await page.getByRole(${JSON.stringify(stp.role)}, { name: ${JSON.stringify(stp.name)} }).click();`;
    case 'expectUrl': return `await expect(page).toHaveURL(new RegExp(${JSON.stringify(stp.value)}));`;
    case 'expectText': return `await expect(page.locator(${JSON.stringify(stp.selector || 'body')})).toContainText(${JSON.stringify(stp.value ?? '')});`;
    case 'inspect': return '// inspect (sin aserción)';
    default: return `// op no reproducible: ${stp.op}`;
  }
}

// Construye un spec Playwright EJECUTABLE a partir de los pasos de navegador que el agente verificó EN VIVO.
// UN test por requisito R# (no por paso): conciso, trazable 1:1 con la spec, todo en el mismo archivo/proceso.
// requirementTexts: mapa { R1: 'texto del criterio' } para rotular. Solo incluye pasos con observación ok.
export function buildAgentReplaySpec(specId, baseUrl, steps, requirementTexts = {}) {
  const base = String(baseUrl || '').replace(/\/$/, '');
  const browserSteps = (steps || []).filter((s) => s.action?.type === 'browser' && s.observation?.ok);
  const lines = [
    `// Generado por chalc qa --agent: réplica de lo verificado en vivo para ${specId}. Un test por requisito.`,
    "import { test, expect } from '@playwright/test';",
    ''
  ];
  if (!browserSteps.length) {
    lines.push(`test.fixme('${specId}: el agente no ejecutó pasos de navegador reproducibles', () => {});`, '');
    return lines.join('\n');
  }
  // Sesión compartida (serial): los R# corren en orden sobre la MISMA página, igual que el agente en vivo,
  // así el estado (navegación, login) se mantiene entre requisitos. Un test por R#: conciso y trazable.
  lines.push(
    "test.describe.configure({ mode: 'serial' });",
    'let page;',
    'test.beforeAll(async ({ browser }) => { page = await browser.newPage(); });',
    'test.afterAll(async () => { await page.close(); });',
    ''
  );
  // Agrupa por el R# que cada acción declara verificar (campo "requirement"); sin él, cae en "general".
  const groups = new Map();
  for (const record of browserSteps) {
    const req = String(record.action.requirement || 'general').toUpperCase();
    if (!groups.has(req)) groups.set(req, []);
    groups.get(req).push(record);
  }
  for (const [req, records] of groups) {
    const text = requirementTexts[req] ? ` — ${requirementTexts[req]}` : '';
    const title = `${req}${text}`.replace(/'/g, "\\'").slice(0, 100);
    lines.push(`test('${title}', async () => {`);   // usa la `page` compartida, no una página por test
    for (const record of records) for (const stp of record.action.steps || []) lines.push('  ' + playwrightLine(base, stp));
    lines.push('});', '');
  }
  return lines.join('\n');
}

// Executor de navegador (superficie web). Carga Playwright de forma perezosa: NO es dependencia del core.
// auth (opcional): la sesión que el usuario adjuntó. { headers:{Authorization}, storage:[{type,key,value}] }.
// Se inyecta ANTES de cualquier navegación, para que la app arranque ya autenticada.
export async function createBrowserExecutor(baseUrl, { auth } = {}) {
  let pw;
  try { pw = await import('playwright'); }
  catch { throw new Error('La superficie web requiere Playwright. Instálalo: npm i -D playwright && npx playwright install chromium'); }

  const base = String(baseUrl || '').replace(/\/$/, '');
  const browser = await pw.chromium.launch();
  const context = await browser.newContext({ recordVideo: process.env.CHALC_QA_VIDEO === '1' ? {} : undefined });
  if (auth?.headers && Object.keys(auth.headers).length) await context.setExtraHTTPHeaders(auth.headers);
  if (auth?.storage?.length) {
    await context.addInitScript((items) => {
      for (const it of items) {
        try { (it.type === 'session' ? sessionStorage : localStorage).setItem(it.key, it.value); } catch { /* storage no disponible aún */ }
      }
    }, auth.storage);
  }
  const page = await context.newPage();

  const exec = async (action) => {
    if (!action || action.type !== 'browser') return { ok: false, error: `acción no soportada en web: ${action?.type}` };
    const log = [];
    try {
      for (const stp of action.steps || []) {
        if (stp.op === 'goto') {
          await page.goto(base + (stp.url?.startsWith('/') ? stp.url : '/' + (stp.url || '')), { waitUntil: 'domcontentloaded', timeout: 15000 });
          // SPA (Angular/React/Vue): domcontentloaded NO espera el render. Espera a que el body tenga contenido.
          await page.waitForFunction(() => document.body && document.body.innerText.trim().length > 0, { timeout: 8000 }).catch(() => {});
          log.push(`goto ${stp.url}`);
        }
        else if (stp.op === 'fill') { await page.fill(stp.selector, stp.value ?? ''); log.push(`fill ${stp.selector}`); }
        else if (stp.op === 'fillByLabel') { await page.getByLabel(stp.label).fill(stp.value ?? ''); log.push(`fill label ${stp.label}`); }
        else if (stp.op === 'click') { await page.click(stp.selector); log.push(`click ${stp.selector}`); }
        else if (stp.op === 'clickByRole') { await page.getByRole(stp.role, { name: stp.name }).click(); log.push(`click role ${stp.role}`); }
        else if (stp.op === 'expectUrl') { const found = new RegExp(stp.value).test(page.url()); log.push(`expectUrl ${stp.value} ⇒ ${found ? 'sí' : 'no'}`); if (!found) return { ok: false, log, detail: `URL actual: ${page.url()}` }; }
        else if (stp.op === 'inspect') { const text = await page.locator('body').innerText(); return { ok: true, log, url: page.url(), text }; }
        else if (stp.op === 'expectText') {
          const txt = (await page.textContent(stp.selector)) || '';
          const found = txt.includes(stp.value ?? '');
          log.push(`expectText ${stp.selector} ⇒ ${found ? 'sí' : 'no'}`);
          if (!found) return { ok: false, log, detail: `no se encontró "${stp.value}" en ${stp.selector}` };
        } else log.push(`op desconocida: ${stp.op}`);
      }
      return { ok: true, log, url: page.url() };
    } catch (e) {
      const screenshot = await page.screenshot({ fullPage: true }).then((x) => x.toString('base64')).catch(() => '');
      return { ok: false, log, error: String(e?.message || e), screenshotBase64: screenshot };
    }
  };
  exec.close = async () => { await context.close(); await browser.close(); };
  return exec;
}
