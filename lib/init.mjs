// lib/init.mjs — registro de stacks para `chalc init`: arquitecturas sugeridas, pasos del scaffolder
// OFICIAL de cada lenguaje (ng new / nest new / dotnet new) y carpetas por arquitectura.
// Determinista y sin tokens: analiza la propuesta por señales y sugiere; el usuario decide.
// Bilingüe (es/en) según el idioma del sistema: los textos de arquitectura son { es, en }.

import { lang } from './i18n.mjs';
import { architectureFlow, renderFolderMap } from './init-folders.mjs';

// Elige el texto en el idioma activo. Acepta string plano (no localizado) u objeto { es, en }.
export function archText(value) {
  if (value && typeof value === 'object') return value[lang] || value.es || value.en || '';
  return value || '';
}

export const MANDATORY_DESIGN_PRINCIPLES = lang === 'en'
  ? ['minimal implementation', 'Clean Code', 'SOLID', 'modular architecture', 'high cohesion and low coupling', 'testable-by-design code', 'explicit responsibilities per folder, file and symbol']
  : ['implementación mínima', 'Clean Code', 'SOLID', 'arquitectura modular', 'alta cohesión y bajo acoplamiento', 'código testeable desde el diseño', 'responsabilidades explícitas por carpeta, archivo y símbolo'];

// --- Selección de versión del scaffolder según el Node instalado ---------------------------------
// Los CLIs oficiales (Angular sobre todo) ABORTAN si el Node no cumple su `engines`. En vez de clavar
// @latest, elegimos el major del CLI más nuevo que el Node de la persona soporta. Así `chalc init` se
// acomoda a la máquina del usuario en vez de exigirle actualizar Node.

// Compara dos semver numéricos ("22.20.0" vs "22.22.3"): -1, 0 o 1.
function cmpSemver(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d < 0 ? -1 : 1; }
  return 0;
}

// ¿El Node instalado cae en una rama soportada por este major del CLI?
// req: { byMajor: { 22: '22.22.3', 24: '24.15.0' }, gte: 26 } → cubre ^22.22.3 || ^24.15.0 || >=26.
function nodeMeets(nodeVer, req) {
  const clean = String(nodeVer).replace(/^v/, '');
  const major = Number(clean.split('.')[0]);
  if (req.gte && major >= req.gte) return true;
  const floor = req.byMajor[major];
  return floor ? cmpSemver(clean, floor) >= 0 : false;
}

// Tablas Node→major del CLI (de más nuevo a más viejo). Fuente: engines de cada paquete.
// Angular: angular.dev/reference/versions. Mantener al salir un major nuevo de Angular/Nest.
export const ANGULAR_CLI_NODE = [
  { tag: '22', req: { byMajor: { 22: '22.22.3', 24: '24.15.0' }, gte: 26 } },
  { tag: '20', req: { byMajor: { 20: '20.19.0', 22: '22.12.0' }, gte: 24 } },
  { tag: '19', req: { byMajor: { 18: '18.19.1', 20: '20.11.1' }, gte: 22 } }
];
export const NEST_CLI_NODE = [
  { tag: 'latest', req: { byMajor: {}, gte: 20 } },   // NestJS 11
  { tag: '10', req: { byMajor: { 16: '16.14.0', 18: '18.0.0' }, gte: 18 } }
];

// Elige el tag del CLI más nuevo compatible con el Node dado. Si ninguno encaja, cae a 'latest'
// (y el propio CLI mostrará su requerimiento). nodeVer es inyectable para tests deterministas.
export function pickCliTag(table, nodeVer = process.version) {
  return (table.find((e) => nodeMeets(nodeVer, e.req)) || { tag: 'latest' }).tag;
}
export function angularCliPkg(nodeVer) { return `@angular/cli@${pickCliTag(ANGULAR_CLI_NODE, nodeVer)}`; }
export function nestCliPkg(nodeVer) { return `@nestjs/cli@${pickCliTag(NEST_CLI_NODE, nodeVer)}`; }

// Resuelve qué versión del scaffolder usará un stack (para avisar al usuario). null si no aplica (dotnet).
export function resolveScaffoldTool(stackId, nodeVer = process.version) {
  if (stackId === 'angular') return { pkg: '@angular/cli', tag: pickCliTag(ANGULAR_CLI_NODE, nodeVer) };
  if (stackId === 'nestjs') return { pkg: '@nestjs/cli', tag: pickCliTag(NEST_CLI_NODE, nodeVer) };
  return null;
}

// Cada stack: scaffold OFICIAL (pasos a ejecutar), verify (install+build) y arquitecturas con sus carpetas.
// step.cwd: 'parent' = el scaffolder crea <name>/ desde el directorio padre; 'project' = corre dentro de <name>/.
export const STACKS = {
  angular: {
    label: 'Angular (TypeScript)',
    scaffold: () => [{ label: 'ng new (Angular CLI)', command: 'npx', args: (name) => ['--yes', angularCliPkg(), 'new', name, '--routing', '--style=css', '--ssr=false', '--skip-git', '--defaults'], cwd: 'parent' }],
    verify: [
      { label: { es: 'instalar dependencias', en: 'install dependencies' }, command: 'npm', args: ['install'] },
      { label: { es: 'compilar', en: 'build' }, command: 'npm', args: ['run', 'build'] }
    ],
    pick: (a) => a.complexity === 'alta' || a.signals.includes('domain') ? 'modular-clean-architecture' : a.signals.includes('enterprise') ? 'enterprise-modular' : 'modular-feature-first',
    architectures: [
      { id: 'modular-feature-first', label: 'Angular Modular Feature-First', fit: { es: 'MVPs, dashboards y productos que necesitan velocidad sin perder orden.', en: 'MVPs, dashboards and products that need speed without losing structure.' }, tradeoff: { es: 'Menos ceremonia inicial; cuida los boundaries para no degradarse al crecer.', en: 'Less upfront ceremony; mind the boundaries so it does not degrade as it grows.' }, folders: ['src/app/core', 'src/app/shared', 'src/app/features'] },
      { id: 'modular-clean-architecture', label: 'Angular Modular Clean Architecture', fit: { es: 'Apps con reglas de negocio claras, vida larga o dominio que debe aislarse de UI/API.', en: 'Apps with clear business rules, long life, or a domain that must be isolated from UI/API.' }, tradeoff: { es: 'Más estructura inicial; compensa cuando hay dominio real y cambios frecuentes.', en: 'More upfront structure; pays off with a real domain and frequent change.' }, folders: ['src/app/core', 'src/app/shared', 'src/app/domain', 'src/app/application', 'src/app/infrastructure', 'src/app/presentation'] },
      { id: 'enterprise-modular', label: 'Angular Enterprise Modular', fit: { es: 'Equipos grandes, módulos lazy, permisos, múltiples dominios y mantenimiento sostenido.', en: 'Large teams, lazy modules, permissions, multiple domains and sustained maintenance.' }, tradeoff: { es: 'Mayor disciplina y más decisiones al inicio; evita deuda en proyectos grandes.', en: 'More discipline and upfront decisions; avoids debt on large projects.' }, folders: ['src/app/core', 'src/app/shared', 'src/app/features', 'src/app/layouts', 'src/app/domains', 'src/app/testing'] }
    ]
  },

  nestjs: {
    label: 'NestJS (TypeScript)',
    scaffold: () => [{ label: 'nest new (NestJS CLI)', command: 'npx', args: (name) => ['--yes', nestCliPkg(), 'new', name, '--skip-git', '--package-manager', 'npm'], cwd: 'parent' }],
    verify: [
      { label: { es: 'instalar dependencias', en: 'install dependencies' }, command: 'npm', args: ['install'] },
      { label: { es: 'compilar', en: 'build' }, command: 'npm', args: ['run', 'build'] }
    ],
    pick: (a) => a.signals.includes('enterprise') || a.signals.includes('realtime') ? 'enterprise-microservices' : (a.complexity === 'alta' || a.signals.includes('domain')) ? 'clean-hexagonal' : 'modular-feature',
    architectures: [
      { id: 'modular-feature', label: 'NestJS Modular por Features', fit: { es: 'APIs y servicios que crecen por módulos; rápido y ordenado.', en: 'APIs and services that grow by modules; fast and tidy.' }, tradeoff: { es: 'Menos capas; cuida los boundaries entre módulos.', en: 'Fewer layers; mind boundaries between modules.' }, folders: ['src/common', 'src/config', 'src/modules'] },
      { id: 'clean-hexagonal', label: 'NestJS Clean / Hexagonal', fit: { es: 'Dominio que debe aislarse del framework y la infraestructura.', en: 'A domain that must be isolated from the framework and infrastructure.' }, tradeoff: { es: 'Más capas y mapeo; compensa con reglas de negocio reales.', en: 'More layers and mapping; pays off with real business rules.' }, folders: ['src/common', 'src/config', 'src/modules', 'src/domain', 'src/application', 'src/infrastructure'] },
      { id: 'enterprise-microservices', label: 'NestJS Enterprise / Microservicios', fit: { es: 'Múltiples servicios, colas, health checks, equipos grandes.', en: 'Multiple services, queues, health checks, large teams.' }, tradeoff: { es: 'Más operación e infraestructura desde el inicio.', en: 'More operations and infrastructure from the start.' }, folders: ['src/common', 'src/config', 'src/modules', 'src/health', 'libs'] }
    ]
  },

  dotnet: {
    label: '.NET / C# (Web API)',
    scaffold: (architectureId) => architectureId === 'clean-architecture'
      ? [
          { label: { es: 'crear solución', en: 'create solution' }, command: 'dotnet', args: (name) => ['new', 'sln', '-n', name], cwd: 'project' },
          { label: 'Domain', command: 'dotnet', args: (name) => ['new', 'classlib', '-n', `${name}.Domain`, '-o', 'src/Domain'], cwd: 'project' },
          { label: 'Application', command: 'dotnet', args: (name) => ['new', 'classlib', '-n', `${name}.Application`, '-o', 'src/Application'], cwd: 'project' },
          { label: 'Infrastructure', command: 'dotnet', args: (name) => ['new', 'classlib', '-n', `${name}.Infrastructure`, '-o', 'src/Infrastructure'], cwd: 'project' },
          { label: 'Api', command: 'dotnet', args: (name) => ['new', 'webapi', '-n', `${name}.Api`, '-o', 'src/Api'], cwd: 'project' },
          { label: { es: 'enlazar proyectos a la solución', en: 'link projects to the solution' }, command: 'dotnet', args: (name) => ['sln', `${name}.sln`, 'add', `src/Domain/${name}.Domain.csproj`, `src/Application/${name}.Application.csproj`, `src/Infrastructure/${name}.Infrastructure.csproj`, `src/Api/${name}.Api.csproj`], cwd: 'project' }
        ]
      : [{ label: 'dotnet new webapi', command: 'dotnet', args: (name) => ['new', 'webapi', '-n', name], cwd: 'parent' }],
    verify: [
      { label: { es: 'restaurar', en: 'restore' }, command: 'dotnet', args: ['restore'] },
      { label: { es: 'compilar', en: 'build' }, command: 'dotnet', args: ['build', '--nologo'] }
    ],
    pick: (a) => a.complexity === 'alta' || a.signals.includes('domain') ? 'clean-architecture' : 'webapi-simple',
    architectures: [
      { id: 'webapi-simple', label: { es: '.NET Web API simple', en: '.NET Web API (simple)' }, fit: { es: 'Servicios pequeños/medianos sin dominio complejo; entrega rápida.', en: 'Small/medium services without a complex domain; fast delivery.' }, tradeoff: { es: 'Pocas capas; refactoriza a clean si el dominio crece.', en: 'Few layers; refactor to clean if the domain grows.' }, folders: ['Controllers', 'Services', 'Models'] },
      { id: 'clean-architecture', label: { es: '.NET Clean Architecture (solución + capas)', en: '.NET Clean Architecture (solution + layers)' }, fit: { es: 'Dominio de negocio real, vida larga, reglas que deben aislarse de framework/DB.', en: 'Real business domain, long life, rules that must be isolated from framework/DB.' }, tradeoff: { es: 'Más proyectos y ceremonia; compensa en sistemas grandes y mantenidos.', en: 'More projects and ceremony; pays off in large, maintained systems.' }, folders: ['src/Domain', 'src/Application', 'src/Infrastructure', 'src/Api'] }
    ]
  },

  // Flutter usa el SDK instalado en la máquina del usuario: `flutter create` toma esa versión (no se fija como en npm).
  flutter: {
    label: 'Flutter (Dart)',
    scaffold: () => [{ label: 'flutter create', command: 'flutter', args: (name) => ['create', name], cwd: 'parent' }],
    verify: [
      { label: { es: 'instalar dependencias', en: 'install dependencies' }, command: 'flutter', args: ['pub', 'get'], cwd: 'project' },
      { label: { es: 'analizar', en: 'analyze' }, command: 'flutter', args: ['analyze'], cwd: 'project' }
    ],
    pick: (a) => a.complexity === 'alta' || a.signals.includes('domain') ? 'clean-architecture' : a.signals.includes('enterprise') ? 'enterprise-modular' : 'feature-first',
    architectures: [
      { id: 'feature-first', label: 'Flutter Feature-First', fit: { es: 'MVPs y apps que crecen por pantallas/funcionalidades; rápido y ordenado.', en: 'MVPs and apps that grow by screens/features; fast and tidy.' }, tradeoff: { es: 'Menos capas; cuida los límites entre features.', en: 'Fewer layers; mind the boundaries between features.' }, folders: ['lib/core', 'lib/shared', 'lib/features'] },
      { id: 'clean-architecture', label: 'Flutter Clean Architecture', fit: { es: 'Reglas de negocio reales, dominio que debe aislarse de UI/datos, vida larga.', en: 'Real business rules, a domain that must be isolated from UI/data, long life.' }, tradeoff: { es: 'Más capas y mapeo; compensa con dominio real y cambios frecuentes.', en: 'More layers and mapping; pays off with a real domain and frequent change.' }, folders: ['lib/core', 'lib/shared', 'lib/presentation', 'lib/domain', 'lib/data'] },
      { id: 'enterprise-modular', label: 'Flutter Enterprise Modular', fit: { es: 'Apps grandes, múltiples dominios, equipos y mantenimiento sostenido.', en: 'Large apps, multiple domains, teams and sustained maintenance.' }, tradeoff: { es: 'Mayor disciplina y decisiones al inicio; evita deuda en proyectos grandes.', en: 'More discipline and upfront decisions; avoids debt on large projects.' }, folders: ['lib/core', 'lib/shared', 'lib/features', 'lib/domain', 'lib/data'] }
    ]
  }
};

export function listStacks() {
  return Object.entries(STACKS).map(([id, s]) => ({ id, label: s.label }));
}

export function getStack(stackId) {
  return STACKS[String(stackId || '').toLowerCase()] || null;
}

const SIGNALS = [
  { id: 'dashboard', re: /dashboard|admin|administr|panel|backoffice|crm|erp/i },
  { id: 'auth', re: /auth|login|usuario|users?|roles?|permisos?|permission|jwt|oauth/i },
  { id: 'forms', re: /formulario|forms?|registro|crear|editar|validaci[oó]n/i },
  { id: 'api', re: /api|endpoint|backend|rest|graphql|servicio externo|microservicio/i },
  { id: 'enterprise', re: /enterprise|empresa|corporativo|equipo|m[oó]dulos?|microfrontend|microservicio|large/i },
  { id: 'domain', re: /regla de negocio|dominio|workflow|proceso|estado|aprobaci[oó]n|business rule|domain/i },
  { id: 'realtime', re: /tiempo real|realtime|websocket|notificaci[oó]n|chat|cola|queue/i }
];

export function slugifyProjectName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'chalc-app';
}

// Nombre de paquete Dart válido: minúsculas con guion_bajo y empieza por letra (Flutter rechaza guiones).
export function dartPackageName(value) {
  let s = slugifyProjectName(value).replace(/-/g, '_');
  if (!/^[a-z]/.test(s)) s = `app_${s}`;
  return s || 'flutter_app';
}

// Análisis NEUTRAL respecto al idioma: devuelve typeKey y códigos de complejidad; el display los localiza.
export function analyzeProjectProposal(text) {
  const source = String(text || '').trim();
  const signals = SIGNALS.filter((item) => item.re.test(source)).map((item) => item.id);
  const complexity = signals.includes('enterprise') || signals.includes('domain')
    ? 'alta'
    : signals.filter((id) => ['auth', 'forms', 'api', 'dashboard'].includes(id)).length >= 3 ? 'media' : 'baja';
  const typeKey = signals.includes('dashboard') ? 'dashboard' : signals.includes('api') ? 'api' : 'app';
  return { typeKey, complexity, signals, missing: [...(!signals.includes('auth') ? ['auth'] : []), ...(!signals.includes('api') ? ['data'] : []), ...(!source ? ['description'] : [])] };
}

export function suggestArchitectures(stackId, analysis) {
  const stack = getStack(stackId);
  if (!stack) return [];
  const preferred = stack.pick(analysis || { complexity: 'baja', signals: [] });
  return stack.architectures.map((item) => ({ ...item, recommended: item.id === preferred }));
}

export function resolveArchitecture(stackId, id) {
  const stack = getStack(stackId);
  if (!stack) return null;
  return stack.architectures.find((item) => item.id === id)
    || stack.architectures.find((item) => item.id === stack.pick({ complexity: 'baja', signals: [] }))
    || stack.architectures[0];
}

export function buildArchitectureDecision({ stack, language, proposal = '', architectureId, clarifications = [] } = {}) {
  const stackId = String(stack || language || 'angular').toLowerCase();
  const analysis = analyzeProjectProposal(proposal);
  const architecture = resolveArchitecture(stackId, architectureId);
  return {
    stack: stackId,
    stackLabel: getStack(stackId)?.label || stackId,
    analysis,
    architecture,
    clarifications: Array.isArray(clarifications) ? clarifications : [],
    mandatoryPrinciples: MANDATORY_DESIGN_PRINCIPLES
  };
}

export function scaffoldSteps(stackId, architectureId, projectName) {
  const stack = getStack(stackId);
  if (!stack) throw new Error(`Stack desconocido: ${stackId}`);
  return stack.scaffold(architectureId).map((step) => ({
    label: archText(step.label),
    command: step.command,
    args: typeof step.args === 'function' ? step.args(projectName) : step.args,
    cwd: step.cwd || 'parent'
  }));
}

export function architectureFolders(stackId, architectureId) {
  return resolveArchitecture(stackId, architectureId)?.folders || [];
}

// Skills extra según la arquitectura: clean/hexagonal/enterprise suman interface-design; las simples no.
export function architectureSkills(stackId, architectureId) {
  return /clean|hexagonal|enterprise/.test(String(architectureId || '')) ? ['interface-design'] : [];
}

export function verifySteps(stackId) {
  return (getStack(stackId)?.verify || []).map((s) => ({ label: archText(s.label), command: s.command, args: s.args }));
}

const DOC = {
  es: { title: 'Decisión arquitectónica inicial', stack: 'Stack', principlesH: 'Principios obligatorios (siempre)', readingH: 'Lectura de la propuesta', typeL: 'Tipo detectado', cxL: 'Complejidad estimada', signalsL: 'Señales', noSignals: 'sin señales fuertes', pendingL: 'Pendiente por confirmar', nothing: 'nada crítico', archH: 'Arquitectura seleccionada', fitL: 'Encaja cuando', tradeoffL: 'Tradeoff', foldersL: 'Carpetas base', clarifH: 'Preguntas resueltas con el usuario', govH: 'Regla de gobierno', gov: 'Chalc sugiere y prepara, pero no es autoridad. La arquitectura seleccionada es una decisión del usuario: revisa tradeoffs, ajusta cuando aprendas más del dominio y cambia esta decisión si el contexto real lo exige.', types: { dashboard: 'dashboard administrativo', api: 'aplicación/servicio con API', app: 'aplicación' }, cx: { alta: 'alta', media: 'media', baja: 'baja' } },
  en: { title: 'Initial architecture decision', stack: 'Stack', principlesH: 'Mandatory principles (always)', readingH: 'Proposal reading', typeL: 'Detected type', cxL: 'Estimated complexity', signalsL: 'Signals', noSignals: 'no strong signals', pendingL: 'To confirm', nothing: 'nothing critical', archH: 'Selected architecture', fitL: 'Fits when', tradeoffL: 'Tradeoff', foldersL: 'Base folders', clarifH: 'Questions resolved with the user', govH: 'Governance rule', gov: "Chalc suggests and prepares, but it is not an authority. The selected architecture is the user's decision: review tradeoffs, adjust as you learn more about the domain, and change this decision if the real context demands it.", types: { dashboard: 'admin dashboard', api: 'API-backed app/service', app: 'application' }, cx: { alta: 'high', media: 'medium', baja: 'low' } }
};

export function localizeType(typeKey) { return (DOC[lang] || DOC.es).types[typeKey] || typeKey; }
export function localizeComplexity(cx) { return (DOC[lang] || DOC.es).cx[cx] || cx; }

export function renderArchitectureDecisionMarkdown(decision) {
  const d = DOC[lang] || DOC.es;
  const a = decision.architecture;
  const flow = architectureFlow(a.folders);
  const mapH = lang === 'en' ? 'Folder map (what goes where)' : 'Mapa de carpetas (qué va en cada una)';
  return [
    `# ${d.title}`,
    '',
    `> ${d.stack}: ${decision.stackLabel}`,
    '',
    `## ${d.principlesH}`,
    '',
    ...decision.mandatoryPrinciples.map((item) => `- ${item}`),
    '',
    `## ${d.readingH}`,
    '',
    `- ${d.typeL}: ${localizeType(decision.analysis.typeKey)}`,
    `- ${d.cxL}: ${localizeComplexity(decision.analysis.complexity)}`,
    `- ${d.signalsL}: ${decision.analysis.signals.length ? decision.analysis.signals.join(', ') : d.noSignals}`,
    `- ${d.pendingL}: ${decision.analysis.missing.length ? decision.analysis.missing.join(', ') : d.nothing}`,
    '',
    `## ${d.archH}`,
    '',
    `- ${archText(a.label)}`,
    `- ${d.fitL}: ${archText(a.fit)}`,
    `- ${d.tradeoffL}: ${archText(a.tradeoff)}`,
    '',
    `## ${mapH}`,
    '',
    ...renderFolderMap(decision.stack, a.folders),
    `## ${flow.depH}`,
    '',
    flow.dep,
    '',
    `## ${flow.addH}`,
    '',
    ...flow.steps.map((s, i) => `${i + 1}. ${s}`),
    '',
    ...(decision.clarifications?.length ? [`## ${d.clarifH}`, '', ...decision.clarifications.map((q) => `- ${q.q}\n  → ${q.a}`), ''] : []),
    `## ${d.govH}`,
    '',
    d.gov,
    ''
  ].join('\n');
}
