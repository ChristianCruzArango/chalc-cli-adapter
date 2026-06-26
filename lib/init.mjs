// lib/init.mjs — registro de stacks para `chalc init`: arquitecturas sugeridas, pasos del scaffolder
// OFICIAL de cada lenguaje (ng new / nest new / dotnet new) y carpetas por arquitectura.
// Determinista y sin tokens: analiza la propuesta por señales y sugiere; el usuario decide.

// Estos principios se aplican SIEMPRE (se equipan vía rules/global.json: clean-code, solid-principles,
// modular-architecture, mutation-testing). Aquí solo se documentan en la decisión.
export const MANDATORY_DESIGN_PRINCIPLES = [
  'Clean Code',
  'SOLID',
  'arquitectura modular',
  'alta cohesión y bajo acoplamiento',
  'código testeable desde el diseño',
  'responsabilidades explícitas por carpeta, archivo y símbolo'
];

// Cada stack: scaffold OFICIAL (pasos a ejecutar), verify (install+build) y arquitecturas con sus carpetas.
// step.cwd: 'parent' = el scaffolder crea <name>/ desde el directorio padre; 'project' = corre dentro de <name>/.
export const STACKS = {
  angular: {
    label: 'Angular (TypeScript)',
    scaffold: () => [{ label: 'ng new (Angular CLI oficial)', command: 'npx', args: (name) => ['--yes', '@angular/cli@latest', 'new', name, '--routing', '--style=css', '--ssr=false', '--skip-git', '--defaults'], cwd: 'parent' }],
    verify: [
      { label: 'instalar dependencias', command: 'npm', args: ['install'] },
      { label: 'compilar', command: 'npm', args: ['run', 'build'] }
    ],
    pick: (a) => a.complexity === 'alta' || a.signals.includes('domain') ? 'modular-clean-architecture' : a.signals.includes('enterprise') ? 'enterprise-modular' : 'modular-feature-first',
    architectures: [
      { id: 'modular-feature-first', label: 'Angular Modular Feature-First', fit: 'MVPs, dashboards y productos que necesitan velocidad sin perder orden.', tradeoff: 'Menos ceremonia inicial; cuida los boundaries para no degradarse al crecer.', folders: ['src/app/core', 'src/app/shared', 'src/app/features'] },
      { id: 'modular-clean-architecture', label: 'Angular Modular Clean Architecture', fit: 'Apps con reglas de negocio claras, vida larga o dominio que debe aislarse de UI/API.', tradeoff: 'Más estructura inicial; compensa cuando hay dominio real y cambios frecuentes.', folders: ['src/app/core', 'src/app/shared', 'src/app/features', 'src/app/domain', 'src/app/application', 'src/app/infrastructure', 'src/app/presentation'] },
      { id: 'enterprise-modular', label: 'Angular Enterprise Modular', fit: 'Equipos grandes, módulos lazy, permisos, múltiples dominios y mantenimiento sostenido.', tradeoff: 'Mayor disciplina y más decisiones al inicio; evita deuda en proyectos grandes.', folders: ['src/app/core', 'src/app/shared', 'src/app/features', 'src/app/layouts', 'src/app/domains', 'src/app/testing'] }
    ]
  },

  nestjs: {
    label: 'NestJS (TypeScript)',
    scaffold: () => [{ label: 'nest new (NestJS CLI oficial)', command: 'npx', args: (name) => ['--yes', '@nestjs/cli@latest', 'new', name, '--skip-git', '--package-manager', 'npm'], cwd: 'parent' }],
    verify: [
      { label: 'instalar dependencias', command: 'npm', args: ['install'] },
      { label: 'compilar', command: 'npm', args: ['run', 'build'] }
    ],
    pick: (a) => a.signals.includes('enterprise') || a.signals.includes('realtime') ? 'enterprise-microservices' : (a.complexity === 'alta' || a.signals.includes('domain')) ? 'clean-hexagonal' : 'modular-feature',
    architectures: [
      { id: 'modular-feature', label: 'NestJS Modular por Features', fit: 'APIs y servicios que crecen por módulos; rápido y ordenado.', tradeoff: 'Menos capas; cuida los boundaries entre módulos.', folders: ['src/common', 'src/config', 'src/modules'] },
      { id: 'clean-hexagonal', label: 'NestJS Clean / Hexagonal', fit: 'Dominio que debe aislarse del framework y la infraestructura.', tradeoff: 'Más capas y mapeo; compensa con reglas de negocio reales.', folders: ['src/common', 'src/config', 'src/modules', 'src/domain', 'src/application', 'src/infrastructure'] },
      { id: 'enterprise-microservices', label: 'NestJS Enterprise / Microservicios', fit: 'Múltiples servicios, colas, health checks, equipos grandes.', tradeoff: 'Más operación e infraestructura desde el inicio.', folders: ['src/common', 'src/config', 'src/modules', 'src/health', 'libs'] }
    ]
  },

  dotnet: {
    label: '.NET / C# (Web API)',
    // El scaffold de .NET depende de la arquitectura: webapi simple = 1 proyecto; clean = solución + capas.
    scaffold: (architectureId) => architectureId === 'clean-architecture'
      ? [
          { label: 'crear solución', command: 'dotnet', args: (name) => ['new', 'sln', '-n', name], cwd: 'project' },
          { label: 'capa Domain', command: 'dotnet', args: (name) => ['new', 'classlib', '-n', `${name}.Domain`, '-o', 'src/Domain'], cwd: 'project' },
          { label: 'capa Application', command: 'dotnet', args: (name) => ['new', 'classlib', '-n', `${name}.Application`, '-o', 'src/Application'], cwd: 'project' },
          { label: 'capa Infrastructure', command: 'dotnet', args: (name) => ['new', 'classlib', '-n', `${name}.Infrastructure`, '-o', 'src/Infrastructure'], cwd: 'project' },
          { label: 'capa Api', command: 'dotnet', args: (name) => ['new', 'webapi', '-n', `${name}.Api`, '-o', 'src/Api'], cwd: 'project' },
          { label: 'enlazar proyectos a la solución', command: 'dotnet', args: (name) => ['sln', `${name}.sln`, 'add', `src/Domain/${name}.Domain.csproj`, `src/Application/${name}.Application.csproj`, `src/Infrastructure/${name}.Infrastructure.csproj`, `src/Api/${name}.Api.csproj`], cwd: 'project' }
        ]
      : [{ label: 'dotnet new webapi', command: 'dotnet', args: (name) => ['new', 'webapi', '-n', name], cwd: 'parent' }],
    verify: [
      { label: 'restaurar', command: 'dotnet', args: ['restore'] },
      { label: 'compilar', command: 'dotnet', args: ['build', '--nologo'] }
    ],
    pick: (a) => a.complexity === 'alta' || a.signals.includes('domain') ? 'clean-architecture' : 'webapi-simple',
    architectures: [
      { id: 'webapi-simple', label: '.NET Web API simple', fit: 'Servicios pequeños/medianos sin dominio complejo; entrega rápida.', tradeoff: 'Pocas capas; refactoriza a clean si el dominio crece.', folders: ['Controllers', 'Services', 'Models'] },
      { id: 'clean-architecture', label: '.NET Clean Architecture (solución + capas)', fit: 'Dominio de negocio real, vida larga, reglas que deben aislarse de framework/DB.', tradeoff: 'Más proyectos y ceremonia; compensa en sistemas grandes y mantenidos.', folders: ['src/Domain', 'src/Application', 'src/Infrastructure', 'src/Api'] }
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
  { id: 'domain', re: /regla de negocio|dominio|workflow|proceso|estado|aprobaci[oó]n/i },
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

export function analyzeProjectProposal(text) {
  const source = String(text || '').trim();
  const signals = SIGNALS.filter((item) => item.re.test(source)).map((item) => item.id);
  const complexity = signals.includes('enterprise') || signals.includes('domain')
    ? 'alta'
    : signals.filter((id) => ['auth', 'forms', 'api', 'dashboard'].includes(id)).length >= 3 ? 'media' : 'baja';
  const type = signals.includes('dashboard') ? 'dashboard administrativo'
    : signals.includes('api') ? 'aplicación/servicio con API'
      : 'aplicación';
  return {
    type,
    complexity,
    signals,
    missing: [
      ...(!signals.includes('auth') ? ['autenticación/roles'] : []),
      ...(!signals.includes('api') ? ['origen de datos/API'] : []),
      ...(!source ? ['descripción funcional'] : [])
    ]
  };
}

// Sugiere las arquitecturas del stack, marcando la recomendada según el análisis (aliado, no oráculo).
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

export function buildArchitectureDecision({ stack, language, proposal = '', architectureId } = {}) {
  const stackId = String(stack || language || 'angular').toLowerCase();
  const analysis = analyzeProjectProposal(proposal);
  const architecture = resolveArchitecture(stackId, architectureId);
  return {
    stack: stackId,
    stackLabel: getStack(stackId)?.label || stackId,
    analysis,
    architecture,
    mandatoryPrinciples: MANDATORY_DESIGN_PRINCIPLES
  };
}

// Pasos del scaffolder OFICIAL para (stack, arquitectura, nombre). args se resuelve con el nombre del proyecto.
export function scaffoldSteps(stackId, architectureId, projectName) {
  const stack = getStack(stackId);
  if (!stack) throw new Error(`Stack desconocido: ${stackId}`);
  return stack.scaffold(architectureId).map((step) => ({
    label: step.label,
    command: step.command,
    args: typeof step.args === 'function' ? step.args(projectName) : step.args,
    cwd: step.cwd || 'parent'
  }));
}

export function architectureFolders(stackId, architectureId) {
  return resolveArchitecture(stackId, architectureId)?.folders || [];
}

// Skills extra según la arquitectura elegida: las clean/hexagonal/enterprise suman interface-design
// (puertos y boundaries). Las simples (feature-first/webapi-simple) no suman nada (anti over-equipamiento).
export function architectureSkills(stackId, architectureId) {
  return /clean|hexagonal|enterprise/.test(String(architectureId || '')) ? ['interface-design'] : [];
}

export function verifySteps(stackId) {
  return getStack(stackId)?.verify || [];
}

export function renderArchitectureDecisionMarkdown(decision) {
  const a = decision.architecture;
  return [
    '# Decisión arquitectónica inicial',
    '',
    `> Stack: ${decision.stackLabel}`,
    '',
    '## Principios obligatorios (siempre)',
    '',
    ...decision.mandatoryPrinciples.map((item) => `- ${item}`),
    '',
    '## Lectura de la propuesta',
    '',
    `- Tipo detectado: ${decision.analysis.type}`,
    `- Complejidad estimada: ${decision.analysis.complexity}`,
    `- Señales: ${decision.analysis.signals.length ? decision.analysis.signals.join(', ') : 'sin señales fuertes'}`,
    `- Pendiente por confirmar: ${decision.analysis.missing.length ? decision.analysis.missing.join(', ') : 'nada crítico'}`,
    '',
    '## Arquitectura seleccionada',
    '',
    `- ${a.label}`,
    `- Encaja cuando: ${a.fit}`,
    `- Tradeoff: ${a.tradeoff}`,
    `- Carpetas base: ${a.folders.join(', ')}`,
    '',
    '## Regla de gobierno',
    '',
    'Chalc sugiere y prepara. El usuario decide y puede cambiar la arquitectura si el contexto real lo exige.',
    ''
  ].join('\n');
}
