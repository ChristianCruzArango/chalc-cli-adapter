// lib/init-folders.mjs — guías por carpeta para `chalc init`. Una sola fuente de contenido que se usa
// (a) como README.md dentro de cada carpeta de la arquitectura y (b) como "mapa de carpetas" dentro de
// docs/architecture.md. Bilingüe (es/en). El rol de una carpeta = su último segmento (core, domain, …).

import { lang } from './i18n.mjs';

export function folderRole(folderPath) {
  return String(folderPath).split('/').filter(Boolean).pop().toLowerCase();
}

// Guía por rol: propósito, qué va, buenas prácticas (bullets) y skills sugeridas por stack.
// Las skills 'clean-code', 'solid-principles' y 'modular-architecture' aplican SIEMPRE (no se repiten aquí).
const GUIDES = {
  core: {
    title: 'Core',
    es: { purpose: 'Servicios singleton y configuración transversal, cargados una sola vez.', goes: 'Guards, interceptors HTTP, configuración global, providers de raíz y servicios de arranque.', tips: ['Sin UI ni reglas de negocio aquí.', 'Se importa solo desde el root; nunca desde un feature.', 'Una responsabilidad por servicio/provider.'] },
    en: { purpose: 'Singleton services and cross-cutting configuration, loaded once.', goes: 'Guards, HTTP interceptors, global config, root providers and bootstrap services.', tips: ['No UI and no business rules here.', 'Imported only from the root; never from a feature.', 'One responsibility per service/provider.'] },
    skills: { angular: ['angular-di', 'angular-routing', 'angular-http'] }
  },
  shared: {
    title: 'Shared',
    es: { purpose: 'Piezas reutilizables y "tontas" (sin estado de negocio) que usan varias features.', goes: 'Componentes de presentación reutilizables, pipes, directivas, utilidades y tipos compartidos.', tips: ['Nada específico de un feature.', 'Componentes presentacionales: entran @Input, salen @Output.', 'Sin dependencias hacia features ni infraestructura.'] },
    en: { purpose: 'Reusable, "dumb" (no business state) pieces used by several features.', goes: 'Reusable presentational components, pipes, directives, utilities and shared types.', tips: ['Nothing feature-specific.', 'Presentational components: @Input in, @Output out.', 'No dependencies toward features or infrastructure.'] },
    skills: { angular: ['angular-component', 'angular-directives', 'responsive-design', 'tailwind-best-practices'] }
  },
  features: {
    title: 'Features',
    es: { purpose: 'Cada feature es un módulo vertical y autocontenido del producto.', goes: 'Una carpeta por feature (p. ej. `tickets/`, `users/`) con sus componentes, rutas, estado y servicios.', tips: ['Un feature no importa a otro feature: comparte vía `shared`/`core`.', 'Rutas lazy por feature.', 'El estado vive dentro del feature salvo que sea realmente global.'] },
    en: { purpose: 'Each feature is a vertical, self-contained slice of the product.', goes: 'One folder per feature (e.g. `tickets/`, `users/`) with its components, routes, state and services.', tips: ['A feature never imports another feature: share via `shared`/`core`.', 'Lazy routes per feature.', 'State lives inside the feature unless it is truly global.'] },
    skills: { angular: ['angular-component', 'angular-signals', 'angular-forms', 'angular-routing'] }
  },
  domain: {
    title: 'Domain',
    es: { purpose: 'El corazón: reglas de negocio puras, sin framework ni I/O.', goes: 'Entidades, value objects, lógica de dominio e **interfaces (puertos)** de repositorios/servicios.', tips: ['CERO imports de Angular/Nest, HTTP o librerías de infraestructura.', 'No depende de ninguna otra capa; todas dependen de ella.', 'Las dependencias externas se expresan como interfaces aquí.'] },
    en: { purpose: 'The heart: pure business rules, no framework, no I/O.', goes: 'Entities, value objects, domain logic and repository/service **interfaces (ports)**.', tips: ['ZERO imports of Angular/Nest, HTTP or infrastructure libraries.', 'Depends on no other layer; every layer depends on it.', 'External dependencies are expressed as interfaces here.'] },
    skills: { default: ['solid-principles', 'interface-design'] }
  },
  application: {
    title: 'Application',
    es: { purpose: 'Casos de uso: orquesta el dominio para cumplir una intención del usuario.', goes: 'Use cases / application services, DTOs de entrada-salida y orquestación de puertos del dominio.', tips: ['Depende solo de `domain` (por sus interfaces), nunca de `infrastructure`.', 'Sin detalles de UI ni de framework.', 'Un caso de uso = una operación de negocio.'] },
    en: { purpose: 'Use cases: orchestrates the domain to fulfill a user intent.', goes: 'Use cases / application services, input-output DTOs and orchestration of domain ports.', tips: ['Depends only on `domain` (via its interfaces), never on `infrastructure`.', 'No UI or framework details.', 'One use case = one business operation.'] },
    skills: { default: ['solid-principles', 'interface-design'] }
  },
  data: {
    title: 'Data',
    es: { purpose: 'Capa de datos: implementa los repositorios del dominio y habla con el mundo exterior.', goes: 'Repository implementations, data sources (API/local), DTOs/models y mapeo a entidades del dominio.', tips: ['Implementa las interfaces (repositorios) definidas en `domain`.', 'Aquí vive el detalle técnico (HTTP, base de datos, caché); la UI nunca lo importa directo.', 'Mapea modelos externos a entidades del dominio.'] },
    en: { purpose: 'Data layer: implements the domain repositories and talks to the outside world.', goes: 'Repository implementations, data sources (API/local), DTOs/models and mapping to domain entities.', tips: ['Implements the (repository) interfaces defined in `domain`.', 'Technical detail lives here (HTTP, DB, cache); the UI never imports it directly.', 'Maps external models to domain entities.'] },
    skills: { flutter: ['flutter-async', 'interface-design'], default: ['interface-design'] }
  },
  infrastructure: {
    title: 'Infrastructure',
    es: { purpose: 'Adaptadores hacia el mundo exterior: implementan los puertos del dominio.', goes: 'Implementaciones de repositorios, clientes HTTP/persistencia, storage y servicios externos.', tips: ['Implementa las interfaces definidas en `domain`.', 'Aquí vive el detalle técnico; ninguna otra capa importa esto directamente.', 'Mapea de modelos externos a entidades del dominio.'] },
    en: { purpose: 'Adapters to the outside world: implement the domain ports.', goes: 'Repository implementations, HTTP/persistence clients, storage and external services.', tips: ['Implements the interfaces defined in `domain`.', 'Technical detail lives here; no other layer imports this directly.', 'Maps external models to domain entities.'] },
    skills: { angular: ['angular-http', 'interface-design'], default: ['interface-design'] }
  },
  presentation: {
    title: 'Presentation',
    es: { purpose: 'La capa de UI: componentes inteligentes, páginas y rutas que consumen casos de uso.', goes: 'Componentes contenedores, páginas, rutas y view-models que llaman a `application`.', tips: ['Habla con `application`, nunca directo con `infrastructure`.', 'Sin reglas de negocio: solo presentación y coordinación de UI.', 'Estado de UI con signals; los datos vienen de los casos de uso.'] },
    en: { purpose: 'The UI layer: smart components, pages and routes that consume use cases.', goes: 'Container components, pages, routes and view-models that call `application`.', tips: ['Talks to `application`, never directly to `infrastructure`.', 'No business rules: only presentation and UI coordination.', 'UI state with signals; data comes from the use cases.'] },
    skills: { angular: ['angular-component', 'angular-signals', 'angular-forms', 'responsive-design'] }
  },
  layouts: {
    title: 'Layouts',
    es: { purpose: 'Estructuras de página reutilizables (shell, sidebar, header) que envuelven features.', goes: 'Componentes de layout y plantillas de página compartidas entre varias rutas.', tips: ['Solo composición visual; sin lógica de negocio.', 'Reciben el contenido por router-outlet o content projection.'] },
    en: { purpose: 'Reusable page structures (shell, sidebar, header) that wrap features.', goes: 'Layout components and page templates shared across several routes.', tips: ['Visual composition only; no business logic.', 'Receive content via router-outlet or content projection.'] },
    skills: { angular: ['angular-component', 'responsive-design'] }
  },
  domains: {
    title: 'Domains',
    es: { purpose: 'Contextos acotados (bounded contexts) cuando el producto crece a varios dominios.', goes: 'Una carpeta por dominio de negocio, cada una con sus reglas y modelos aislados.', tips: ['Cada dominio es independiente; se comunican por contratos explícitos.', 'Evita acoplar dos dominios; si se repite algo, súbelo a `shared`.'] },
    en: { purpose: 'Bounded contexts when the product grows into several domains.', goes: 'One folder per business domain, each with its isolated rules and models.', tips: ['Each domain is independent; they talk via explicit contracts.', 'Avoid coupling two domains; if something repeats, lift it to `shared`.'] },
    skills: { default: ['solid-principles'] }
  },
  testing: {
    title: 'Testing',
    es: { purpose: 'Utilidades y dobles de prueba compartidos por toda la app.', goes: 'Builders, fakes/mocks, fixtures y helpers de test reutilizables.', tips: ['Test-First: el test que falla va antes que el código.', 'Tras Green/refactor, corre mutation testing (score ≥ 80%).'] },
    en: { purpose: 'Shared test utilities and test doubles for the whole app.', goes: 'Builders, fakes/mocks, fixtures and reusable test helpers.', tips: ['Test-First: the failing test comes before the code.', 'After Green/refactor, run mutation testing (score ≥ 80%).'] },
    skills: { angular: ['angular-testing', 'mutation-testing'], default: ['mutation-testing'] }
  },
  common: {
    title: 'Common',
    es: { purpose: 'Código transversal reutilizable por todos los módulos (sin estado de negocio).', goes: 'Pipes, guards, filtros, interceptores, decoradores y utilidades compartidas.', tips: ['Nada específico de un módulo de negocio.', 'Una responsabilidad por archivo.'] },
    en: { purpose: 'Cross-cutting code reused by all modules (no business state).', goes: 'Pipes, guards, filters, interceptors, decorators and shared utilities.', tips: ['Nothing specific to a business module.', 'One responsibility per file.'] },
    skills: { default: ['solid-principles'] }
  },
  config: {
    title: 'Config',
    es: { purpose: 'Configuración tipada y validada de la aplicación.', goes: 'Esquemas de variables de entorno, módulos de configuración y validación al arranque.', tips: ['Valida la config al iniciar; falla rápido si falta algo.', 'Nunca hardcodees secretos: vienen del entorno.'] },
    en: { purpose: 'Typed, validated application configuration.', goes: 'Environment variable schemas, config modules and startup validation.', tips: ['Validate config at boot; fail fast if something is missing.', 'Never hardcode secrets: they come from the environment.'] },
    skills: {}
  },
  modules: {
    title: 'Modules',
    es: { purpose: 'Cada módulo es una feature vertical del backend (controller + service + modelo).', goes: 'Una carpeta por módulo (p. ej. `tickets/`, `auth/`) con su controller, service, DTOs y entidades.', tips: ['Un módulo expone su API por su propio controller.', 'No acoples módulos: comparte por `common` o por contratos.', 'Valida la entrada con DTOs + pipes.'] },
    en: { purpose: 'Each module is a vertical backend feature (controller + service + model).', goes: 'One folder per module (e.g. `tickets/`, `auth/`) with its controller, service, DTOs and entities.', tips: ['A module exposes its API via its own controller.', 'Do not couple modules: share via `common` or contracts.', 'Validate input with DTOs + pipes.'] },
    skills: {}
  },
  health: {
    title: 'Health',
    es: { purpose: 'Observabilidad: health checks y readiness/liveness del servicio.', goes: 'Endpoints de salud, indicadores de dependencias (DB, colas) y chequeos de readiness.', tips: ['Distingue liveness (¿vivo?) de readiness (¿listo para tráfico?).', 'No expongas detalles sensibles en la respuesta.'] },
    en: { purpose: 'Observability: health checks and service readiness/liveness.', goes: 'Health endpoints, dependency indicators (DB, queues) and readiness checks.', tips: ['Separate liveness (alive?) from readiness (ready for traffic?).', 'Do not leak sensitive details in the response.'] },
    skills: {}
  },
  libs: {
    title: 'Libs',
    es: { purpose: 'Librerías internas compartidas entre servicios/módulos del monorepo.', goes: 'Paquetes reutilizables (contratos, utilidades, clientes) con su propio límite público.', tips: ['Cada lib expone una API pública clara y estable.', 'Versiona el contrato; evita filtrar detalles internos.'] },
    en: { purpose: 'Internal libraries shared across services/modules of the monorepo.', goes: 'Reusable packages (contracts, utilities, clients) with their own public boundary.', tips: ['Each lib exposes a clear, stable public API.', 'Version the contract; avoid leaking internal details.'] },
    skills: {}
  }
};

// Guía resuelta para un rol de carpeta (con fallback genérico para roles no listados).
export function folderGuide(stackId, folderPath) {
  const role = folderRole(folderPath);
  const g = GUIDES[role];
  if (!g) {
    const generic = lang === 'en'
      ? { purpose: `Folder \`${role}\` of the chosen architecture.`, goes: 'Code that belongs to this layer/responsibility per the architecture.', tips: ['Keep it within the architecture boundaries (see `docs/architecture.md`).'] }
      : { purpose: `Carpeta \`${role}\` de la arquitectura elegida.`, goes: 'Código que corresponde a esta capa/responsabilidad según la arquitectura.', tips: ['Mantenlo dentro de los límites de la arquitectura (ver `docs/architecture.md`).'] };
    return { role, title: role.charAt(0).toUpperCase() + role.slice(1), ...generic, skills: [] };
  }
  const body = g[lang] || g.es;
  const stackSkills = (g.skills && (g.skills[stackId] || g.skills.default)) || [];
  return { role, title: g.title, purpose: body.purpose, goes: body.goes, tips: body.tips, skills: stackSkills };
}

const T = {
  es: { role: 'Rol', goes: 'Qué va aquí', tips: 'Buenas prácticas', skills: 'Skills que aplican', always: 'Siempre: `clean-code`, `solid-principles`, `modular-architecture`.', backref: 'Visión completa de la arquitectura:', genBy: 'Generado por chalc init — no borres esta guía.' },
  en: { role: 'Role', goes: 'What goes here', tips: 'Best practices', skills: 'Applicable skills', always: 'Always: `clean-code`, `solid-principles`, `modular-architecture`.', backref: 'Full architecture overview:', genBy: 'Generated by chalc init — keep this guide.' }
};

// README.md que se deja DENTRO de cada carpeta de la arquitectura.
export function renderFolderReadme(stackId, archLabel, folderPath) {
  const t = T[lang] || T.es;
  const g = folderGuide(stackId, folderPath);
  const skills = [...g.skills].map((s) => `\`${s}\``).join(', ');
  return [
    `# ${g.title}  ·  ${archLabel}`,
    '',
    `> ${g.purpose}`,
    '',
    `## ${t.goes}`,
    g.goes,
    '',
    `## ${t.tips}`,
    ...g.tips.map((x) => `- ${x}`),
    '',
    `## ${t.skills}`,
    `- ${t.always}`,
    ...(skills ? [`- ${skills}`] : []),
    '',
    `_${t.backref} \`docs/architecture.md\`. ${t.genBy}_`,
    ''
  ].join('\n');
}

const FLOW = {
  es: {
    depH: 'Reglas de dependencia', addH: 'Cómo agregar un feature',
    layered: 'El flujo de dependencias apunta al dominio: las capas externas (UI/presentación, aplicación, datos/infraestructura) dependen de `domain`, y **`domain` no depende de ninguna**. Las capas externas implementan sus interfaces (puertos). Nunca al revés.',
    featurefirst: 'Cada feature depende de `shared` y `core`, **nunca de otro feature**. `core` se carga una sola vez; `shared` no conoce a las features.',
    addLayered: ['Modela la regla en `domain` (entidad + interfaz del repositorio/puerto).', 'Implementa esa interfaz en la capa de datos/infraestructura (HTTP/persistencia).', 'Orquesta el caso de uso (en la capa de aplicación si existe; si no, desde la presentación).', 'Construye la UI en la capa de presentación, que consume el caso de uso/repositorio.', 'Test-First en cada paso; mutation testing al final (≥ 80%).'],
    addFeatureFirst: ['Crea `features/<feature>/` con su ruta lazy.', 'Pon sus componentes, estado y servicios dentro de esa carpeta.', 'Lo reutilizable sube a `shared`; lo transversal a `core`.', 'Test-First; el feature no importa a otro feature.']
  },
  en: {
    depH: 'Dependency rules', addH: 'How to add a feature',
    layered: 'Dependencies point inward to the domain: outer layers (UI/presentation, application, data/infrastructure) depend on `domain`, and **`domain` depends on none**. Outer layers implement its interfaces (ports). Never the other way around.',
    featurefirst: 'Each feature depends on `shared` and `core`, **never on another feature**. `core` loads once; `shared` knows nothing about features.',
    addLayered: ['Model the rule in `domain` (entity + repository/port interface).', 'Implement that interface in the data/infrastructure layer (HTTP/persistence).', 'Orchestrate the use case (in the application layer if present; otherwise from presentation).', 'Build the UI in the presentation layer, consuming the use case/repository.', 'Test-First at each step; mutation testing at the end (≥ 80%).'],
    addFeatureFirst: ['Create `features/<feature>/` with its lazy route.', 'Put its components, state and services inside that folder.', 'Reusable bits go up to `shared`; cross-cutting to `core`.', 'Test-First; the feature must not import another feature.']
  }
};

// ¿Arquitectura por capas? Tiene `domain` y al menos una capa externa (application/data/infrastructure).
// Cubre .NET/Angular (application/infrastructure) y Flutter (domain/data). Si no, es feature-first.
function isLayered(folders) {
  const roles = folders.map(folderRole);
  return roles.includes('domain') && (roles.includes('application') || roles.includes('data') || roles.includes('infrastructure'));
}

// Devuelve los textos de flujo (dependencias + cómo agregar un feature) para docs/architecture.md.
export function architectureFlow(folders) {
  const f = FLOW[lang] || FLOW.es;
  const layered = isLayered(folders);
  return { depH: f.depH, addH: f.addH, dep: layered ? f.layered : f.featurefirst, steps: layered ? f.addLayered : f.addFeatureFirst };
}

// Sección "mapa de carpetas" para docs/architecture.md: una fila por carpeta con su rol y skills.
export function renderFolderMap(stackId, folders) {
  const t = T[lang] || T.es;
  const lines = [];
  for (const rel of folders) {
    const g = folderGuide(stackId, rel);
    const skills = [...g.skills].map((s) => `\`${s}\``).join(', ');
    lines.push(`### \`${rel}\` — ${g.title}`, g.goes, ...(skills ? [`${t.skills}: ${skills}`] : []), '');
  }
  return lines;
}
