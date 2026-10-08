// lib/qa/detect.mjs — detección del proyecto para QA: superficie (web/api), autenticación, cómo
// arrancarlo y en qué URL escucha. Solo lee archivos de configuración, nunca la lógica de la app.

import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { t } from '../i18n.mjs';

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

async function nodeDepSignals(projectPath, signals) {
  const pkgPath = join(projectPath, 'package.json');
  if (!existsSync(pkgPath)) return;
  try {
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    for (const dep of WEB_DEPS) if (deps[dep]) signals.web.push(dep);
    for (const dep of API_DEPS) if (deps[dep]) signals.api.push(dep);
  } catch { /* package.json inválido: sin señales de deps */ }
}

async function manifestSignals(projectPath, manifests, signals) {
  for (const name of manifests) {
    let text = '';
    try { text = (await readFile(join(projectPath, name), 'utf8')).toLowerCase(); } catch { continue; }
    for (const kw of WEB_MANIFEST_KW) if (text.includes(kw)) signals.web.push(`${name}:${kw}`);
    for (const kw of API_MANIFEST_KW) if (text.includes(kw)) signals.api.push(`${name}:${kw}`);
  }
}

// El stack de un backend compilado/manifestado, o '' si no se reconoce ninguno.
function compiledBackend(rootFiles, dotnet) {
  if (dotnet.length) return 'dotnet';
  if (rootFiles.includes('go.mod')) return 'go-module';
  if (rootFiles.includes('pom.xml') || rootFiles.some((n) => n.startsWith('build.gradle'))) return 'jvm';
  if (rootFiles.includes('requirements.txt') || rootFiles.includes('pyproject.toml')) return 'python';
  if (rootFiles.includes('composer.json')) return 'php';
  if (rootFiles.includes('Gemfile')) return 'ruby';
  return '';
}

// Decide si QA prueba por navegador (web) o por HTTP (api). Devuelve las señales que lo justifican.
// web tiene precedencia si hay UI: un backend puede servir API y UI, pero la UI es lo que un QA "persona" recorre.
export async function detectSurface(projectPath) {
  const signals = { web: [], api: [] };

  // 1) Node: dependencias de package.json.
  await nodeDepSignals(projectPath, signals);

  // 2) Archivos raíz delatores.
  for (const file of WEB_FILES) if (existsSync(join(projectPath, file))) signals.web.push(file);
  for (const file of API_FILES) if (existsSync(join(projectPath, file))) signals.api.push(file);

  // 3) Manifiestos no-Node (incluye *.csproj/*.sln de .NET) por palabra clave de framework.
  const rootFiles = await listRootFiles(projectPath);
  const dotnet = rootFiles.filter((name) => /\.(csproj|sln|fsproj|vbproj)$/i.test(name));
  const manifests = [...MANIFEST_FILES.filter((name) => rootFiles.includes(name)), ...dotnet];
  await manifestSignals(projectPath, manifests, signals);

  // 4) Plantillas/markup en el árbol (Razor, Blade, ERB, Vue, Svelte…).
  if (await hasFileWithExt(projectPath, WEB_EXTS)) signals.web.push('plantillas-ui');

  // 5) Fallback: un backend compilado/manifestado sin UI es, por defecto, una superficie HTTP.
  if (!signals.web.length && !signals.api.length) {
    const backend = compiledBackend(rootFiles, dotnet);
    if (backend) signals.api.push(backend);
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

// Arma la sesión del agente QA desde un token explícito (flag --auth-token o env CHALC_QA_TOKEN),
// para poder probar endpoints protegidos SIN TTY. Normaliza: quita comillas/espacios envolventes y
// un prefijo "Bearer" repetido (en cualquier caja). Devuelve { headers } o null si no hay token. Puro.
export function resolveQaAuth({ token } = {}) {
  const raw = String(token || '').trim().replace(/^(['"])(.*)\1$/, '$2').trim();
  const clean = raw.replace(/^bearer\s+/i, '').trim();
  if (!clean) return null;
  return { headers: { Authorization: `Bearer ${clean}` } };
}

async function npmScriptOptions(projectPath) {
  const packageFile = join(projectPath, 'package.json');
  if (!existsSync(packageFile)) return [];
  try {
    const pkg = JSON.parse(await readFile(packageFile, 'utf8'));
    return ['qa:up', 'dev', 'start', 'serve', 'preview']
      .filter((script) => typeof pkg.scripts?.[script] === 'string')
      .map((script) => ({ type: 'command', label: `npm run ${script}`, command: `npm run ${script}` }));
  } catch { return []; /* package.json inválido: no hay opción Node confiable */ }
}

// Layout .NET estándar: .sln en la raíz y los .csproj bajo src/. Solo se ofrecen los proyectos
// EJECUTABLES (con appsettings.json o launchSettings.json); las librerías (Domain, Application…)
// no arrancan nada y ofrecerlas sería ruido. `dotnet run --project <dir>` resuelve el csproj solo.
async function dotnetSrcOptions(projectPath) {
  if (!existsSync(join(projectPath, 'src'))) return [];
  const options = [];
  let srcEntries = [];
  try { srcEntries = (await readdir(join(projectPath, 'src'), { withFileTypes: true })).filter((e) => e.isDirectory()); } catch { /* src ilegible: sin opción .NET */ }
  for (const e of srcEntries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const dir = join(projectPath, 'src', e.name);
    const hasCsproj = (await listRootFiles(dir)).some((name) => /\.csproj$/i.test(name));
    const runnable = existsSync(join(dir, 'appsettings.json')) || existsSync(join(dir, 'Properties', 'launchSettings.json'));
    if (hasCsproj && runnable) {
      const rel = join('src', e.name);
      options.push({ type: 'direct', key: 'dotnet', label: `.NET (dotnet run --project ${rel})`, command: 'dotnet', args: ['run', '--project', rel] });
    }
  }
  return options;
}

// Solo consulta archivos de configuración de arranque, no el código de la aplicación.
export async function findEnvironmentOptions(projectPath) {
  const options = [];
  for (const name of ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml']) {
    if (existsSync(join(projectPath, name))) options.push({ type: 'compose', label: `Docker Compose (${name})`, file: name });
  }
  options.push(...await npmScriptOptions(projectPath));
  // Adaptadores de arranque convencionales. Solo se ofrecen: el usuario los confirma desde el CLI.
  if (existsSync(join(projectPath, 'manage.py'))) options.push({ type: 'direct', key: 'django', label: 'Django (python manage.py runserver)', command: 'python', args: ['manage.py', 'runserver'] });
  if (existsSync(join(projectPath, 'pyproject.toml')) && !existsSync(join(projectPath, 'manage.py'))) options.push({ type: 'direct', key: 'python', label: 'Python (python -m uvicorn app:app)', command: 'python', args: ['-m', 'uvicorn', 'app:app'] });
  const root = await listRootFiles(projectPath);
  const dotnetProject = root.find((name) => /\.csproj$/i.test(name));
  if (dotnetProject) options.push({ type: 'direct', key: 'dotnet', label: `.NET (dotnet run --project ${dotnetProject})`, command: 'dotnet', args: ['run', '--project', dotnetProject] });
  if (!dotnetProject) options.push(...await dotnetSrcOptions(projectPath));
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
