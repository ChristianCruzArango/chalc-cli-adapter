// lib/qa/browser.mjs — superficie web del QA: executor de Playwright y el spec reproducible que se
// genera a partir de los pasos del agente.

import { oneLine } from '../qa.mjs';
import { safeTest, hasNestedQuantifier, escapeRegExp } from '../saferegex.mjs';
import { redactObservation } from './common.mjs';
import { t } from '../i18n.mjs';

// Traduce un paso de navegador del agente a una línea de Playwright. URLs absolutas: sin playwright.config.
// Lo que viene de la spec o del modelo entra en el código generado SOLO como literal serializado o
// dentro de un comentario de una línea (`oneLine`): un `\'` o un salto de línea no puede cerrar el
// literal ni el comentario y convertirse en código que el desarrollador ejecuta con `npx playwright test`.

// Lo que comparten el agente (browserStep) y el spec reproducible (playwrightLine): si cada uno
// interpretara los pasos a su manera, el spec repetiría algo distinto de lo que el agente verificó.
// Plazos de una navegación del agente y de la espera a que una SPA pinte algo en el body.
const NAVIGATION_TIMEOUT_MS = 15000;
const RENDER_WAIT_MS = 8000;
const stepUrl = (base, url) => base + (url?.startsWith('/') ? url : '/' + (url || ''));
const textTarget = (stp) => stp.selector || 'body';
// Un patrón de URL con retroceso exponencial no se evalúa como regex en ningún lado: se compara literal.
const literalUrl = (value) => hasNestedQuantifier(value);
const urlMatches = (value, url) => (literalUrl(value) ? url.includes(String(value)) : safeTest(value ?? '', url));

function playwrightLine(base, stp) {
  switch (stp.op) {
    case 'goto': return `await page.goto(${JSON.stringify(stepUrl(base, stp.url))});`;
    case 'fill': return `await page.fill(${JSON.stringify(stp.selector)}, ${JSON.stringify(stp.value ?? '')});`;
    case 'fillByLabel': return `await page.getByLabel(${JSON.stringify(stp.label)}).fill(${JSON.stringify(stp.value ?? '')});`;
    case 'click': return `await page.click(${JSON.stringify(stp.selector)});`;
    case 'clickByRole': return `await page.getByRole(${JSON.stringify(stp.role)}, { name: ${JSON.stringify(stp.name)} }).click();`;
    case 'expectUrl': return `await expect(page).toHaveURL(new RegExp(${JSON.stringify(literalUrl(stp.value) ? escapeRegExp(stp.value) : String(stp.value ?? ''))}));`;
    // El primer elemento, como el agente (page.textContent): sin `.first()`, el modo estricto de
    // Playwright fallaría el spec cuando el selector coincide con varios elementos.
    case 'expectText': return `await expect(page.locator(${JSON.stringify(textTarget(stp))}).first()).toContainText(${JSON.stringify(stp.value ?? '')});`;
    case 'inspect': return '// inspect (sin aserción)';
    default: return `// op no reproducible: ${oneLine(JSON.stringify(stp.op ?? null))}`;
  }
}

// Construye un spec Playwright EJECUTABLE a partir de los pasos de navegador que el agente verificó EN VIVO.
// UN test por requisito R# (no por paso): conciso, trazable 1:1 con la spec, todo en el mismo archivo/proceso.
// requirementTexts: mapa { R1: 'texto del criterio' } para rotular. Solo incluye pasos con observación ok.
export function buildAgentReplaySpec(specId, baseUrl, steps, requirementTexts = {}) {
  const base = String(baseUrl || '').replace(/\/$/, '');
  const browserSteps = (steps || []).filter((s) => s.action?.type === 'browser' && s.observation?.ok);
  const lines = [
    `// Generado por chalc qa --agent: réplica de lo verificado en vivo para ${oneLine(specId)}. Un test por requisito.`,
    "import { test, expect } from '@playwright/test';",
    ''
  ];
  if (!browserSteps.length) {
    lines.push(`test.fixme(${JSON.stringify(`${specId}: el agente no ejecutó pasos de navegador reproducibles`)}, () => {});`, '');
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
    // Se trunca ANTES de serializar: cortar después podía partir un escape y romper el archivo.
    const title = JSON.stringify(`${req}${text}`.slice(0, 100));
    lines.push(`test(${title}, async () => {`);   // usa la `page` compartida, no una página por test
    for (const record of records) for (const stp of record.action.steps || []) lines.push('  ' + playwrightLine(base, stp));
    lines.push('});', '');
  }
  return lines.join('\n');
}

// La sesión del usuario solo viaja a la app que se prueba. `setExtraHTTPHeaders` la pegaba a TODA
// petición del contexto —CDN, analítica, iframes de terceros, cualquier web a la que navegue el
// agente—, y el init script la escribía en el storage de todos los orígenes y frames.
export function authRoute(origin, headers) {
  return async (route) => {
    const request = route.request();
    let sameOrigin = false;
    try { sameOrigin = new URL(request.url()).origin === origin; } catch { /* URL no http: no es la app */ }
    if (!sameOrigin) return route.continue();
    return route.continue({ headers: { ...request.headers(), ...headers } });
  };
}

// Se ejecuta DENTRO del navegador (Playwright lo serializa): no puede usar nada de este módulo.
export function seedStorage({ origin, items }) {
  if (location.origin !== origin) return;
  for (const it of items) {
    try { (it.type === 'session' ? sessionStorage : localStorage).setItem(it.key, it.value); } catch { /* storage no disponible aún */ }
  }
}

// Ejecuta un paso del agente sobre la página y lo anota en `log` (en inglés: es observación para el
// modelo, como la de cualquier otra herramienta). Devuelve la observación final cuando
// el paso termina la acción (una inspección, o una expectativa que no se cumple); si no, nada.
async function browserStep(page, base, stp, log) {
  if (stp.op === 'goto') {
    await page.goto(stepUrl(base, stp.url), { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS });
    // SPA (Angular/React/Vue): domcontentloaded NO espera el render. Espera a que el body tenga contenido.
    await page.waitForFunction(() => document.body && document.body.innerText.trim().length > 0, { timeout: RENDER_WAIT_MS }).catch(() => {});
    log.push(`goto ${stp.url}`);
  }
  else if (stp.op === 'fill') { await page.fill(stp.selector, stp.value ?? ''); log.push(`fill ${stp.selector}`); }
  else if (stp.op === 'fillByLabel') { await page.getByLabel(stp.label).fill(stp.value ?? ''); log.push(`fill label ${stp.label}`); }
  else if (stp.op === 'click') { await page.click(stp.selector); log.push(`click ${stp.selector}`); }
  else if (stp.op === 'clickByRole') { await page.getByRole(stp.role, { name: stp.name }).click(); log.push(`click role ${stp.role}`); }
  else if (stp.op === 'expectUrl') { const found = urlMatches(stp.value, page.url()); log.push(`expectUrl ${stp.value} ⇒ ${found ? 'yes' : 'no'}`); if (!found) return { ok: false, log, detail: `current URL: ${page.url()}` }; }
  else if (stp.op === 'inspect') { const text = await page.locator('body').innerText(); return { ok: true, log, url: page.url(), text }; }
  else if (stp.op === 'expectText') {
    const txt = (await page.textContent(textTarget(stp))) || '';
    const found = txt.includes(stp.value ?? '');
    log.push(`expectText ${textTarget(stp)} ⇒ ${found ? 'yes' : 'no'}`);
    if (!found) return { ok: false, log, detail: `"${stp.value}" not found in ${textTarget(stp)}` };
  } else log.push(`unknown op: ${stp.op}`);
  return null;
}

// Executor de navegador (superficie web). Carga Playwright de forma perezosa: NO es dependencia del core.
// auth (opcional): la sesión que el usuario adjuntó. { headers:{Authorization}, storage:[{type,key,value}] }.
// Se inyecta ANTES de cualquier navegación, para que la app arranque ya autenticada.
export async function createBrowserExecutor(baseUrl, { auth, screenshots = process.env.CHALC_QA_SCREENSHOTS === '1' } = {}) {
  let pw;
  try { pw = await import('playwright'); }
  catch { throw new Error(t('qaNeedsPlaywright')); }

  const base = String(baseUrl || '').replace(/\/$/, '');
  const browser = await pw.chromium.launch();
  const context = await browser.newContext({ recordVideo: process.env.CHALC_QA_VIDEO === '1' ? {} : undefined });
  const origin = new URL(base).origin;
  if (auth?.headers && Object.keys(auth.headers).length) await context.route('**/*', authRoute(origin, auth.headers));
  if (auth?.storage?.length) await context.addInitScript(seedStorage, { origin, items: auth.storage });
  const page = await context.newPage();
  const failureScreenshot = async () => {
    if (!screenshots) return '';
    const mask = page.locator('input, textarea, [contenteditable="true"], [data-sensitive], [data-secret], [name*="token" i], [name*="password" i], [aria-label*="token" i], [aria-label*="password" i]');
    return page.screenshot({ fullPage: true, mask: [mask] }).then((x) => x.toString('base64')).catch(() => '');
  };

  const exec = async (action) => {
    if (!action || action.type !== 'browser') return { ok: false, error: `action not supported on the web surface: ${action?.type}` };
    const log = [];
    try {
      for (const stp of action.steps || []) {
        const ended = await browserStep(page, base, stp, log);
        if (ended) return redactObservation(ended);
      }
      return redactObservation({ ok: true, log, url: page.url() });
    } catch (e) {
      const screenshot = await failureScreenshot();
      return redactObservation({ ok: false, log, error: String(e?.message || e), screenshotBase64: screenshot });
    }
  };
  exec.close = async () => { await context.close(); await browser.close(); };
  return exec;
}
