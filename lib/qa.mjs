// lib/qa.mjs — capacidades mínimas del QA spec-driven, sin conocer código de la aplicación.

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { t } from './i18n.mjs';

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
  if (!existsSync(path)) return null;
  return JSON.parse(await readFile(path, 'utf8'));
}

export function qaTestPath(projectPath, specId) {
  return join(projectPath, 'qa', 'e2e', `${specId}.spec.mjs`);
}

// Spec ejecutable que el agente escribe con los pasos que verificó en vivo (separado del estático del wizard).
export function qaAgentTestPath(projectPath, specId) {
  return join(projectPath, 'qa', 'e2e', `${specId}.agent.spec.mjs`);
}

// Genera pruebas Playwright reproducibles solo con datos observables entregados en el wizard.
// Si falta ruta o expectativa, queda fixme: no se inventan selectores ni flujos.
export function buildBrowserTests(context, inputs = {}) {
  const byId = new Map((inputs.cases || []).map((item) => [String(item.id).toUpperCase(), item]));
  const lines = [
    `// Generado por chalc qa desde specs/${context.id}/spec.md.`,
    "import { test, expect } from '@playwright/test';",
    ''
  ];
  for (const item of requirements(context.files['spec.md'])) {
    const detail = byId.get(item.id) || {};
    const title = `${item.id} — ${item.text}`.replaceAll("'", "\\'");
    if (!detail.path || !detail.expected) {
      lines.push(
        `// Faltan ruta o resultado observable en specs/${context.id}/qa/inputs.json.`,
        `test.fixme('${title}', () => {});`,
        ''
      );
      continue;
    }
    lines.push(
      `test('${title}', async ({ page }) => {`,
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

// Señales de superficie multi-stack. web = UI navegable (browser); api = solo HTTP. No lee la lógica de la app.
const WEB_DEPS = ['@angular/core', 'react', 'react-dom', 'vue', 'svelte', '@sveltejs/kit', 'next', 'nuxt', 'astro', 'vite', '@vitejs/plugin-react'];
const API_DEPS = ['@nestjs/core', 'express', 'fastify', 'koa', '@hapi/hapi', 'restify', '@apollo/server', 'apollo-server'];
// Archivos raíz que delatan UI navegable (incluye marcadores de Django/Laravel/Rails).
const WEB_FILES = ['angular.json', 'index.html', 'public/index.html', 'src/index.html', 'vite.config.js', 'vite.config.ts', 'next.config.js', 'nuxt.config.ts', 'manage.py', 'artisan', 'config.ru'];
const API_FILES = ['nest-cli.json'];
// Extensiones de plantilla/markup (scan acotado del árbol) que implican vistas renderizadas en navegador.
const WEB_EXTS = ['.cshtml', '.razor', '.blade.php', '.erb', '.vue', '.svelte'];
// Manifiestos no-Node a leer (texto) en busca de palabras clave de framework.
const MANIFEST_FILES = ['pom.xml', 'build.gradle', 'build.gradle.kts', 'requirements.txt', 'pyproject.toml', 'Pipfile', 'composer.json', 'Gemfile', 'go.mod'];
const WEB_MANIFEST_KW = ['blazor', 'razor', 'mvc', 'thymeleaf', 'django', 'flask', 'laravel/framework', 'rails', 'sinatra', 'spring-boot-starter-thymeleaf', 'jinja2'];
const API_MANIFEST_KW = ['fastapi', 'spring-boot-starter-web', 'spring-webflux', 'swashbuckle', 'microsoft.aspnetcore', 'gin-gonic', 'labstack/echo', 'gofiber', 'flask-restful', 'djangorestframework'];

async function listRootFiles(projectPath) {
  try { return (await readdir(projectPath, { withFileTypes: true })).filter((e) => e.isFile()).map((e) => e.name); }
  catch { return []; }
}

// Busca, de forma acotada (profundidad y tope de entradas), si existe algún archivo con una de las extensiones.
async function hasFileWithExt(projectPath, exts, { maxDepth = 3, cap = 600 } = {}) {
  let seen = 0;
  const walk = async (dir, depth) => {
    if (depth > maxDepth || seen > cap) return false;
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return false; }
    for (const entry of entries) {
      if (++seen > cap) return false;
      if (entry.isDirectory()) {
        if (['node_modules', '.git', 'bin', 'obj', 'dist', 'build', 'vendor', '.venv'].includes(entry.name)) continue;
        if (await walk(join(dir, entry.name), depth + 1)) return true;
      } else if (exts.some((ext) => entry.name.toLowerCase().endsWith(ext))) {
        return true;
      }
    }
    return false;
  };
  return walk(projectPath, 1);
}

// Decide si QA prueba por navegador (web) o por HTTP (api). Devuelve las señales que lo justifican.
// web tiene precedencia si hay UI: un backend puede servir API y UI, pero la UI es lo que un QA "persona" recorre.
export async function detectSurface(projectPath) {
  const signals = { web: [], api: [] };

  // 1) Node: dependencias de package.json.
  const pkgPath = join(projectPath, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      for (const dep of WEB_DEPS) if (deps[dep]) signals.web.push(dep);
      for (const dep of API_DEPS) if (deps[dep]) signals.api.push(dep);
    } catch { /* package.json inválido: sin señales de deps */ }
  }

  // 2) Archivos raíz delatores.
  for (const file of WEB_FILES) if (existsSync(join(projectPath, file))) signals.web.push(file);
  for (const file of API_FILES) if (existsSync(join(projectPath, file))) signals.api.push(file);

  // 3) Manifiestos no-Node (incluye *.csproj/*.sln de .NET) por palabra clave de framework.
  const rootFiles = await listRootFiles(projectPath);
  const dotnet = rootFiles.filter((name) => /\.(csproj|sln|fsproj|vbproj)$/i.test(name));
  const manifests = [...MANIFEST_FILES.filter((name) => rootFiles.includes(name)), ...dotnet];
  for (const name of manifests) {
    let text = '';
    try { text = (await readFile(join(projectPath, name), 'utf8')).toLowerCase(); } catch { continue; }
    for (const kw of WEB_MANIFEST_KW) if (text.includes(kw)) signals.web.push(`${name}:${kw}`);
    for (const kw of API_MANIFEST_KW) if (text.includes(kw)) signals.api.push(`${name}:${kw}`);
  }

  // 4) Plantillas/markup en el árbol (Razor, Blade, ERB, Vue, Svelte…).
  if (await hasFileWithExt(projectPath, WEB_EXTS)) signals.web.push('plantillas-ui');

  // 5) Fallback: un backend compilado/manifestado sin UI es, por defecto, una superficie HTTP.
  if (!signals.web.length && !signals.api.length) {
    if (dotnet.length) signals.api.push('dotnet');
    else if (rootFiles.includes('go.mod')) signals.api.push('go-module');
    else if (rootFiles.includes('pom.xml') || rootFiles.some((n) => n.startsWith('build.gradle'))) signals.api.push('jvm');
    else if (rootFiles.includes('requirements.txt') || rootFiles.includes('pyproject.toml')) signals.api.push('python');
    else if (rootFiles.includes('composer.json')) signals.api.push('php');
    else if (rootFiles.includes('Gemfile')) signals.api.push('ruby');
  }

  const surface = signals.web.length ? 'web' : signals.api.length ? 'api' : 'unknown';
  return { surface, signals };
}

// Señales de que la app exige autenticación: guards de ruta, interceptor Bearer, MSAL, tokens en storage.
const AUTH_SIGNALS = [
  { re: /\bcanActivate\b/, label: 'guards de ruta' },
  { re: /Authorization[\s\S]{0,40}Bearer|setHeaders[\s\S]{0,60}Authorization/, label: 'interceptor Bearer' },
  { re: /@azure\/msal|MsalGuard|\bMSAL\b/i, label: 'MSAL' },
  { re: /AccessGuard|AuthGuard|authGuard/, label: 'auth guard' }
];

// Escanea el código (acotado) buscando señales de autenticación y las claves de token en storage.
// Devuelve { needsAuth, signals, storageKeys, hasLoginRoute } para poder PEDIRLE al usuario la sesión.
export async function detectAuth(projectPath) {
  const signals = new Set();
  const storageKeys = new Set();
  let hasLoginRoute = false;
  let scanned = 0;
  const walk = async (dir, depth) => {
    if (depth > 5 || scanned > 500) return;
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (scanned > 500) return;
      if (entry.isDirectory()) { if (!['node_modules', '.git', 'dist', '.angular', 'coverage'].includes(entry.name)) await walk(join(dir, entry.name), depth + 1); continue; }
      if (!/\.(ts|js|mjs)$/.test(entry.name) || /\.(spec|test)\./.test(entry.name)) continue;
      scanned++;
      let text = '';
      try { text = await readFile(join(dir, entry.name), 'utf8'); } catch { continue; }
      for (const sig of AUTH_SIGNALS) if (sig.re.test(text)) signals.add(sig.label);
      for (const m of text.matchAll(/(?:local|session)Storage\.(?:get|set)Item\(\s*['"`]([^'"`]+)['"`]/g)) storageKeys.add(m[1]);
      if (/path:\s*['"`]login['"`]/.test(text)) hasLoginRoute = true;
    }
  };
  const base = existsSync(join(projectPath, 'src')) ? join(projectPath, 'src') : projectPath;
  await walk(base, 1);
  return { needsAuth: signals.size > 0, signals: [...signals], storageKeys: [...storageKeys], hasLoginRoute };
}

// Solo consulta archivos de configuración de arranque, no el código de la aplicación.
export async function findEnvironmentOptions(projectPath) {
  const options = [];
  for (const name of ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml']) {
    if (existsSync(join(projectPath, name))) options.push({ type: 'compose', label: `Docker Compose (${name})`, file: name });
  }
  const packageFile = join(projectPath, 'package.json');
  if (existsSync(packageFile)) {
    try {
      const pkg = JSON.parse(await readFile(packageFile, 'utf8'));
      for (const script of ['qa:up', 'dev', 'start', 'serve', 'preview']) {
        if (typeof pkg.scripts?.[script] === 'string') options.push({ type: 'command', label: `npm run ${script}`, command: `npm run ${script}` });
      }
    } catch { /* package.json inválido: no hay opción Node confiable */ }
  }
  // Adaptadores de arranque convencionales. Solo se ofrecen: el usuario los confirma desde el CLI.
  if (existsSync(join(projectPath, 'manage.py'))) options.push({ type: 'direct', key: 'django', label: 'Django (python manage.py runserver)', command: 'python', args: ['manage.py', 'runserver'] });
  if (existsSync(join(projectPath, 'pyproject.toml')) && !existsSync(join(projectPath, 'manage.py'))) options.push({ type: 'direct', key: 'python', label: 'Python (python -m uvicorn app:app)', command: 'python', args: ['-m', 'uvicorn', 'app:app'] });
  const root = await listRootFiles(projectPath);
  const dotnetProject = root.find((name) => /\.csproj$/i.test(name));
  if (dotnetProject) options.push({ type: 'direct', key: 'dotnet', label: `.NET (dotnet run --project ${dotnetProject})`, command: 'dotnet', args: ['run', '--project', dotnetProject] });
  if (root.includes('go.mod')) options.push({ type: 'direct', key: 'go', label: 'Go (go run .)', command: 'go', args: ['run', '.'] });
  if (root.includes('pom.xml')) options.push({ type: 'direct', key: 'maven', label: 'Spring/Maven (mvn spring-boot:run)', command: 'mvn', args: ['spring-boot:run'] });
  if (root.includes('build.gradle') || root.includes('build.gradle.kts')) options.push({ type: 'direct', key: 'gradle', label: 'Spring/Gradle (gradle bootRun)', command: 'gradle', args: ['bootRun'] });
  if (root.includes('pubspec.yaml')) options.push({ type: 'direct', key: 'flutter-web', label: 'Flutter web (flutter run -d web-server)', command: 'flutter', args: ['run', '-d', 'web-server'] });
  if (root.includes('artisan')) options.push({ type: 'direct', key: 'laravel', label: 'Laravel (php artisan serve)', command: 'php', args: ['artisan', 'serve'] });
  if (root.includes('Gemfile')) options.push({ type: 'direct', key: 'rails', label: 'Rails (bin/rails server)', command: 'bin/rails', args: ['server'] });
  return options;
}

// Deriva cómo arrancar y cómo bajar un entorno, sin ejecutarlo. Puro y testeable.
// compose corre detached (up -d) y se baja con down; un script npm corre en primer plano y se baja matando el proceso.
// port (opcional): fuerza el dev server a ese puerto para que chalc SEPA la URL y evite choques de puerto.
// npm: `npm run <script> -- --port N`. direct: `<cmd> ... --port N`. compose: usa su propio mapeo (no se fuerza).
export function buildStartCommand(env, { port } = {}) {
  if (!env) throw new Error(t('qaNoEnvToStart'));
  if (env.type === 'compose') {
    const projectName = env.projectName || 'chalc-qa';
    return {
      command: 'docker',
      args: ['compose', '--project-name', projectName, '-f', env.file, 'up', '-d'],
      down: { command: 'docker', args: ['compose', '--project-name', projectName, '-f', env.file, 'down'] }
    };
  }
  if (env.type === 'direct') {
    const args = [...(env.args || [])];
    if (port) args.push('--port', String(port));
    return { command: env.command, args, down: null };
  }
  const match = /^npm run (.+)$/.exec(env.command || '');
  if (!match) throw new Error(t('qaCannotStartEnv', env.label || env.command || t('qaUnknown')));
  const args = ['run', match[1]];
  if (port) args.push('--', '--port', String(port));
  return { command: 'npm', args, down: null };
}

export function qaComposeProjectName(specId) {
  return `chalc-qa-${String(specId || 'run').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'run'}`;
}

export function normalizeQaUrl(raw) {
  let url;
  try { url = new URL(String(raw || '')); } catch { throw new Error(t('qaUrlInvalid')); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(t('qaUrlProtocol'));
  return url.toString().replace(/\/$/, '');
}

// Puerto por defecto del dev server según el stack: si chalc levanta la app, debe SABER dónde responde.
// Se devuelve también la lista de candidatos por si el primero no responde (probamos varios al verificar salud).
const URL_BY_FILE = [
  { file: 'angular.json', urls: ['http://localhost:4200'] },
  { file: 'nuxt.config.ts', urls: ['http://localhost:3000'] },
  { file: 'next.config.js', urls: ['http://localhost:3000'] },
  { file: 'next.config.ts', urls: ['http://localhost:3000'] },
  { file: 'vite.config.ts', urls: ['http://localhost:5173'] },
  { file: 'vite.config.js', urls: ['http://localhost:5173'] },
  { file: 'nest-cli.json', urls: ['http://localhost:3000'] },
  { file: 'manage.py', urls: ['http://localhost:8000'] },
  { file: 'artisan', urls: ['http://localhost:8000'] },
  { file: 'go.mod', urls: ['http://localhost:8080'] }
];
const URL_BY_DEP = [
  { dep: '@angular/core', urls: ['http://localhost:4200'] },
  { dep: 'vite', urls: ['http://localhost:5173'] },
  { dep: 'next', urls: ['http://localhost:3000'] },
  { dep: 'nuxt', urls: ['http://localhost:3000'] },
  { dep: '@nestjs/core', urls: ['http://localhost:3000'] }
];

// Mejor estimación de la(s) URL(es) donde responderá la app que chalc va a levantar. Nunca lanza.
export async function guessBaseUrls(projectPath) {
  for (const sig of URL_BY_FILE) if (existsSync(join(projectPath, sig.file))) return sig.urls;
  const pkgPath = join(projectPath, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      for (const sig of URL_BY_DEP) if (deps[sig.dep]) return sig.urls;
    } catch { /* package.json inválido */ }
  }
  return ['http://localhost:3000', 'http://localhost:8080', 'http://localhost:5000'];   // candidatos comunes
}

// Sondea una URL hasta que el servidor responda (cualquier HTTP = vivo, incluye 401/404) o se agoten los intentos.
// fetch y sleep son inyectables para poder testear sin red ni esperas reales.
export async function waitForHttp(url, opts = {}) {
  const { attempts = 30, intervalMs = 1000, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), shouldAbort = () => false } = opts;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (shouldAbort()) return { ok: false, attempts: attempt - 1, aborted: true };
    try {
      const res = await fetchImpl(url, { method: 'GET' });
      return { ok: true, status: res.status, attempts: attempt };
    } catch {
      if (attempt < attempts) await sleep(intervalMs);
    }
  }
  return { ok: false, attempts };
}

// Como waitForHttp pero prueba varios candidatos por ronda: devuelve la URL que respondió en `url`.
// Útil cuando chalc levanta la app y no está 100% seguro del puerto (Angular 4200 vs Vite 5173, etc.).
export async function waitForAny(urls, opts = {}) {
  const list = (Array.isArray(urls) ? urls : [urls]).filter(Boolean);
  const { attempts = 30, intervalMs = 1000, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), shouldAbort = () => false } = opts;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (shouldAbort()) return { ok: false, attempts: attempt - 1, aborted: true };
    for (const url of list) {
      try { const res = await fetchImpl(url, { method: 'GET' }); return { ok: true, status: res.status, attempts: attempt, url }; }
      catch { /* prueba el siguiente candidato */ }
    }
    if (attempt < attempts) await sleep(intervalMs);
  }
  return { ok: false, attempts };
}

const CMD_ERR_MAX = 2000;   // recorta el stderr para no inundar la consola si un build falla con mucho output

async function command(command, args, cwd) {
  try {
    const { stdout } = await execFileAsync(command, args, { timeout: 8_000, cwd, maxBuffer: 4 * 1024 * 1024 });
    return { ok: true, stdout: String(stdout).trim() };
  } catch (error) {
    if (error?.code === 'ENOENT') return { ok: false, error: 'not-found' };
    const detail = String(error?.stderr || error?.message || '').trim();
    return { ok: false, error: detail.length > CMD_ERR_MAX ? detail.slice(0, CMD_ERR_MAX) + ' …[recortado]' : detail };
  }
}

// Verifica si el proyecto tiene el runner de Playwright (@playwright/test) para correr specs con `npx playwright test`.
export async function probePlaywright(projectPath, run = command) {
  const res = await run('node', ['-e', 'process.stdout.write(require("@playwright/test/package.json").version)'], projectPath);
  if (!res.ok) return { available: false, detail: '@playwright/test no está instalado. Instálalo: npm i -D @playwright/test && npx playwright install chromium' };
  return { available: true, version: res.stdout, detail: `@playwright/test ${res.stdout}` };
}

// Distingue binario ausente, daemon apagado y Compose disponible. No inicia ni modifica Docker.
export async function probeDocker(run = command) {
  const binary = await run('docker', ['--version']);
  if (!binary.ok) return { installed: false, daemon: false, compose: false, detail: 'Docker no está instalado o no está disponible en PATH.' };

  const daemon = await run('docker', ['info', '--format', '{{.ServerVersion}}']);
  const compose = await run('docker', ['compose', 'version', '--short']);
  return {
    installed: true,
    daemon: daemon.ok,
    compose: compose.ok,
    detail: !daemon.ok
      ? 'Docker está instalado, pero el daemon no está disponible.'
      : !compose.ok
        ? 'Docker está disponible, pero Docker Compose v2 no lo está.'
        : 'Docker y Docker Compose están disponibles.',
    version: binary.stdout || undefined,
    composeVersion: compose.ok ? compose.stdout || undefined : undefined
  };
}
