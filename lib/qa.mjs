// lib/qa.mjs — capacidades mínimas del QA spec-driven, sin conocer código de la aplicación.

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { t } from './i18n.mjs';
import { fetchWithTimeout } from './net.mjs';
import { MAX_CHILD_OUTPUT } from './proc.mjs';
import { readJsonOrKeep } from './userdata.mjs';

// Cada sondeo de arranque tiene su propio plazo: un servidor que acepta la conexión y no responde
// no puede bloquear la espera entera.
const PROBE_TIMEOUT_MS = 5000;
const probe = (url, init) => fetchWithTimeout(url, { ...init, timeoutMs: PROBE_TIMEOUT_MS });

const execFileAsync = promisify(execFile);

export async function listSpecs(projectPath) {
  const specsDir = join(projectPath, 'specs');
  if (!existsSync(specsDir)) return [];
  const entries = await readdir(specsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && /^\d{3,4}-/.test(entry.name) && existsSync(join(specsDir, entry.name, 'spec.md')))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export function requirementIds(specText) {
  return [...new Set([...String(specText || '').matchAll(/^\s*-?\s*\*\*(R\d+)\*\*/gim)].map((match) => match[1].toUpperCase()))];
}

export function duplicateRequirementIds(specText) {
  const seen = new Set();
  const duplicate = new Set();
  for (const item of requirements(specText)) {
    if (seen.has(item.id)) duplicate.add(item.id);
    seen.add(item.id);
  }
  return [...duplicate];
}

export async function readSpecContext(projectPath, specId) {
  const dir = join(projectPath, 'specs', specId);
  const wanted = ['spec.md', 'plan.md', 'tasks.md', 'data-model.md', 'quickstart.md'];
  const files = {};
  for (const name of wanted) {
    const path = join(dir, name);
    if (existsSync(path)) files[name] = await readFile(path, 'utf8');
  }
  if (!files['spec.md']) throw new Error(t('qaSpecMissing', specId));
  return { id: specId, files, requirements: requirementIds(files['spec.md']), duplicateRequirements: duplicateRequirementIds(files['spec.md']) };
}

export function requirements(specText) {
  return [...String(specText || '').matchAll(/^\s*-?\s*\*\*(R\d+)\*\*\s*[—-]?\s*(.+)$/gim)]
    .map((match) => ({ id: match[1].toUpperCase(), text: match[2].trim() }));
}

// Clave estable para elegir un entorno por bandera (--env): el script npm o el archivo compose.
export function environmentKey(option) {
  if (!option) return '';
  if (option.type === 'compose') return option.file;
  if (option.type === 'direct') return option.key || option.command;
  return String(option.command || '').replace(/^npm run /, '');
}

// Resuelve --env contra los entornos detectados. Devuelve null si no se pidió ninguno.
// Lanza Error (con las opciones válidas) si se pidió uno que no existe, para no arrancar a ciegas.
export function selectEnvironment(options, query) {
  const wanted = String(query || '').trim().toLowerCase();
  if (!wanted) return null;
  const found = (options || []).find((option) => environmentKey(option).toLowerCase() === wanted || option.label.toLowerCase() === wanted);
  if (!found) throw new Error(t('qaEnvNotDetected', query, (options || []).map(environmentKey).join(', ') || t('qaNoneFem')));
  return found;
}

// El plan es la única pieza que se puede derivar con fidelidad de la spec sin conocer la UI ni el código.
// Los pasos concretos de navegador se completarán después de que QA explore la aplicación en ejecución.
// env es opcional: si se eligió uno con --env, se registra su comando de arranque (sin ejecutarlo).
export function buildQaPlan(context, env) {
  const rows = requirements(context.files['spec.md']);
  const launch = env ? `\`${env.command || env.file}\` (${env.type})` : '_pendiente: elige uno con `--env`_';
  const header = [
    `# Plan QA — ${context.id}`,
    '',
    '> Generado desde `spec.md`. Este plan no añade comportamiento fuera de la spec.',
    '> Antes de automatizar, resuelve cualquier duda funcional y prepara datos de prueba.',
    '',
    `**Entorno de arranque:** ${launch}`,
    '',
    '## Trazabilidad',
    '',
    '| Requisito | Criterio de la spec | Estrategia QA | Estado |',
    '|---|---|---|---|'
  ];
  const table = rows.length
    ? rows.map((item) => `| ${item.id} | ${item.text.replaceAll('|', '\\|')} | Pendiente: definir flujo visible/API pública | PENDING |`)
    : ['| — | No se detectaron requisitos R# en la spec. | Corregir spec antes de probar. | BLOCKED |'];
  return [...header, ...table, '', '## Preguntas QA', '', '- [ ] Datos de prueba y credenciales QA disponibles.', '- [ ] URL/base URL del entorno QA definida.', '- [ ] La spec describe resultados observables para cada R#.', ''].join('\n');
}

export function qaPlanPath(projectPath, specId) {
  return join(projectPath, 'specs', specId, 'qa', 'test-plan.md');
}

export function qaResultsPath(projectPath, specId) {
  return join(projectPath, 'specs', specId, 'qa', 'results.md');
}

export function qaInputsPath(projectPath, specId) {
  return join(projectPath, 'specs', specId, 'qa', 'inputs.json');
}

// Datos operativos no secretos: los secretos se referencian por nombre de variable, nunca se guardan.
export async function writeQaInputs(projectPath, specId, inputs) {
  const path = qaInputsPath(projectPath, specId);
  await mkdir(join(projectPath, 'specs', specId, 'qa'), { recursive: true });
  await writeFile(path, JSON.stringify(inputs, null, 2) + '\n', 'utf8');
  return path;
}

export async function readQaInputs(projectPath, specId) {
  const path = qaInputsPath(projectPath, specId);
  return readJsonOrKeep(path, null);
}

export function qaTestPath(projectPath, specId) {
  return join(projectPath, 'qa', 'e2e', `${specId}.spec.mjs`);
}

// Spec ejecutable que el agente escribe con los pasos que verificó en vivo (separado del estático del wizard).
export function qaAgentTestPath(projectPath, specId) {
  return join(projectPath, 'qa', 'e2e', `${specId}.agent.spec.mjs`);
}

// Texto apto para un comentario `//` de código generado: sin saltos de línea que lo cierren y dejen
// el resto como código ejecutable.
export const oneLine = (text) => String(text ?? '').replace(/[\r\n\u2028\u2029]+/g, ' ');

// Genera pruebas Playwright reproducibles solo con datos observables entregados en el wizard.
// Si falta ruta o expectativa, queda fixme: no se inventan selectores ni flujos.
export function buildBrowserTests(context, inputs = {}) {
  const byId = new Map((inputs.cases || []).map((item) => [String(item.id).toUpperCase(), item]));
  const lines = [
    `// Generado por chalc qa desde specs/${oneLine(context.id)}/spec.md.`,
    "import { test, expect } from '@playwright/test';",
    ''
  ];
  for (const item of requirements(context.files['spec.md'])) {
    const detail = byId.get(item.id) || {};
    // Literal serializado: el texto de la HU llega de Jira/Azure/una URL vía IA y no puede ser código.
    const title = JSON.stringify(`${item.id} — ${item.text}`);
    if (!detail.path || !detail.expected) {
      lines.push(
        `// Faltan ruta o resultado observable en specs/${oneLine(context.id)}/qa/inputs.json.`,
        `test.fixme(${title}, () => {});`,
        ''
      );
      continue;
    }
    lines.push(
      `test(${title}, async ({ page }) => {`,
      `  await page.goto(${JSON.stringify(detail.path)});`,
      `  await expect(page.locator('body')).toContainText(${JSON.stringify(detail.expected)});`,
      '});',
      ''
    );
  }
  return lines.join('\n');
}

export async function writeBrowserTests(projectPath, context, inputs) {
  const path = qaTestPath(projectPath, context.id);
  await mkdir(join(projectPath, 'qa', 'e2e'), { recursive: true });
  await writeFile(path, buildBrowserTests(context, inputs), 'utf8');
  return path;
}

// No sobrescribe un plan existente salvo overwrite=true: un plan editado a mano no debe perderse en silencio.
// Devuelve { path, written }: written=false significa que ya existía y se respetó.
export async function writeQaPlan(projectPath, context, env, { overwrite = false } = {}) {
  const path = qaPlanPath(projectPath, context.id);
  if (existsSync(path) && !overwrite) return { path, written: false };
  await mkdir(join(projectPath, 'specs', context.id, 'qa'), { recursive: true });
  await writeFile(path, buildQaPlan(context, env), 'utf8');
  return { path, written: true };
}

export { detectSurface, detectAuth, resolveQaAuth, findEnvironmentOptions, buildStartCommand, qaComposeProjectName, normalizeQaUrl, guessBaseUrls } from './qa/detect.mjs';

// Sondea las URL candidatas hasta que una responda (cualquier HTTP = vivo, incluye 401/404) o se
// agoten los intentos; devuelve la que respondió en `url`. Útil cuando chalc levanta la app y no está
// 100% seguro del puerto (Angular 4200 vs Vite 5173, etc.). `urls` puede ser una función: se vuelve a
// leer en cada ronda (la URL que el dev server anuncia aparece mientras arranca). Cada petición lleva
// su plazo (`probe`): un servidor que acepta la conexión y no contesta no cuelga la espera.
// fetch, sleep y shouldAbort son inyectables para poder testear sin red ni esperas reales.
export async function waitForAny(urls, opts = {}) {
  const candidates = typeof urls === 'function' ? urls : () => (Array.isArray(urls) ? urls : [urls]);
  const { attempts = 30, intervalMs = 1000, fetchImpl = probe, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), shouldAbort = () => false } = opts;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (shouldAbort()) return { ok: false, attempts: attempt - 1, aborted: true };
    for (const url of candidates().filter(Boolean)) {
      try { const res = await fetchImpl(url, { method: 'GET' }); return { ok: true, status: res.status, attempts: attempt, url }; }
      catch { /* prueba el siguiente candidato */ }
    }
    if (attempt < attempts) await sleep(intervalMs);
  }
  return { ok: false, attempts };
}

// Las URL candidatas que NO responden ahora mismo. Se usa antes de lanzar la app: un puerto adivinado
// que ya contesta es de otro servicio (en macOS, el 5000 es el receptor de AirPlay y responde 403), y
// darlo por bueno haría que el agente QA probara contra algo que no es la app.
export async function notAnswering(urls, { fetchImpl = probe } = {}) {
  const free = [];
  for (const url of urls.filter(Boolean)) {
    try { await fetchImpl(url, { method: 'GET' }); } catch { free.push(url); }
  }
  return free;
}

// Lo mismo con una sola URL (el resultado no repite la URL).
export async function waitForHttp(url, opts = {}) {
  const { url: _answered, ...result } = await waitForAny([url], opts);
  return result;
}

// Una sonda (`docker --version`, `npx playwright --version`) responde en segundos o no está.
const PROBE_COMMAND_TIMEOUT_MS = 8000;
const CMD_ERR_MAX = 2000;   // recorta el stderr para no inundar la consola si un build falla con mucho output

async function command(command, args, cwd) {
  try {
    const { stdout } = await execFileAsync(command, args, { timeout: PROBE_COMMAND_TIMEOUT_MS, cwd, maxBuffer: MAX_CHILD_OUTPUT });
    return { ok: true, stdout: String(stdout).trim() };
  } catch (error) {
    if (error?.code === 'ENOENT') return { ok: false, error: 'not-found' };
    const detail = String(error?.stderr || error?.message || '').trim();
    return { ok: false, error: detail.length > CMD_ERR_MAX ? detail.slice(0, CMD_ERR_MAX) + ' ' + t('qaTrimmed') : detail };
  }
}

// Verifica si el proyecto tiene el runner de Playwright (@playwright/test) para correr specs con `npx playwright test`.
export async function probePlaywright(projectPath, run = command) {
  const res = await run('node', ['-e', 'process.stdout.write(require("@playwright/test/package.json").version)'], projectPath);
  if (!res.ok) return { available: false, detail: t('qaPlaywrightMissing') };
  return { available: true, version: res.stdout, detail: `@playwright/test ${res.stdout}` };
}

// Distingue binario ausente, daemon apagado y Compose disponible. No inicia ni modifica Docker.
export async function probeDocker(run = command) {
  const binary = await run('docker', ['--version']);
  if (!binary.ok) return { installed: false, daemon: false, compose: false, detail: t('qaDockerMissing') };

  const daemon = await run('docker', ['info', '--format', '{{.ServerVersion}}']);
  const compose = await run('docker', ['compose', 'version', '--short']);
  return {
    installed: true,
    daemon: daemon.ok,
    compose: compose.ok,
    detail: !daemon.ok
      ? t('qaDockerNoDaemon')
      : !compose.ok
        ? t('qaDockerNoCompose')
        : t('qaDockerReady'),
    version: binary.stdout || undefined,
    composeVersion: compose.ok ? compose.stdout || undefined : undefined
  };
}
