// lib/commands/verbs.mjs — el registro ÚNICO de comandos (M-04). Cada verbo declara aquí sus alias, si
// tiene simulación real con --dry-run, de qué posicional sale su proyecto y cómo se carga. Antes había
// que tocar cuatro sitios (COMMANDS, DRY_RUN_COMMANDS, VERB_ALIASES y una cadena de ternarios).
//
// No importa ningún comando: `load` es un import() perezoso (literal, para que se pueda seguir), así context.mjs (que importan todos los
// comandos) puede leer el registro sin crear ciclos, y cada ejecución carga solo el comando que usa.
//
// project: índice del posicional que nombra el proyecto; `null` = el comando no lleva ruta (debate: sus
// posicionales son la IDEA); 'spec' = regla propia de `spec` (último argumento, si parece una ruta).
// dryRun: comandos con simulación real; los de solo lectura (inspect, doctor, tokens) no escriben.

export const VERBS = {
  lang: { aliases: ['lang', 'config-lang', 'idioma', 'language'], dryRun: false, project: 0, load: () => import('./lang.mjs').then((m) => m.runConfigLang) },
  init: { aliases: ['init', 'new', 'create'], dryRun: true, project: 0, load: () => import('./init.mjs').then((m) => m.runInit) },
  install: { aliases: ['install', 'add'], dryRun: false, project: 2, load: () => import('./configure.mjs').then((m) => m.runInstall) },
  inspect: { aliases: ['inspect', 'explain'], dryRun: true, project: 1, load: () => import('./inspect.mjs').then((m) => m.runInspect) },
  verify: { aliases: ['verify', 'check', 'audit'], dryRun: false, project: 0, load: () => import('./init.mjs').then((m) => m.runVerify) },
  doctor: { aliases: ['doctor'], dryRun: true, project: 1, load: () => import('./doctor.mjs').then((m) => m.runDoctor) },
  configure: { aliases: ['configure', 'config', 'setup'], dryRun: false, project: 0, load: () => import('./configure.mjs').then((m) => m.runConfigure) },
  ai: { aliases: ['config-ia', 'config-ai', 'configia', 'ai', 'provider'], dryRun: false, project: 0, load: () => import('./ai.mjs').then((m) => m.runAi) },
  aidoctor: { aliases: ['ai-doctor', 'doctor-ia'], dryRun: false, project: 0, load: () => import('./ai.mjs').then((m) => m.runAiDoctor) },
  aieval: { aliases: ['eval-ia', 'eval-ai', 'ai-eval'], dryRun: false, project: 0, load: () => import('./ai.mjs').then((m) => m.runAiEval) },
  specgen: { aliases: ['spec-ia', 'spec-ai', 'spec-gen', 'specgen', 'gen'], dryRun: true, project: 0, load: () => import('./specgen.mjs').then((m) => m.runSpecGen) },
  feature: { aliases: ['feature', 'hu', 'fullstack'], dryRun: false, project: 0, load: () => import('./feature.mjs').then((m) => m.runFeature) },
  spec: { aliases: ['spec', 'specs'], dryRun: false, project: 'spec', load: () => import('./spec.mjs').then((m) => m.runSpec) },
  qa: { aliases: ['qa', 'quality'], dryRun: false, project: 1, load: () => import('./qa.mjs').then((m) => m.runQa) },
  deliver: { aliases: ['deliver', 'delivery'], dryRun: false, project: 1, load: () => import('./deliver.mjs').then((m) => m.runDeliver) },
  tokens: { aliases: ['tokens', 'cost', 'costs', 'costes', 'gasto'], dryRun: true, project: 1, load: () => import('./tokens.mjs').then((m) => m.runTokens) },
  update: { aliases: ['update', 'upgrade', 'sync'], dryRun: false, project: 0, load: () => import('./update.mjs').then((m) => m.runUpdate) },
  dashboard: { aliases: ['dashboard', 'dash', 'monitor'], dryRun: false, project: 0, load: () => import('./dashboard.mjs').then((m) => m.runDashboard) },
  debate: { aliases: ['debate', 'model', 'models', 'debatir'], dryRun: true, project: null, load: () => import('./debate.mjs').then((m) => m.runDebate) },
  // El verbo por defecto: `chalc <ruta>` equipa el proyecto. No tiene alias (cualquier otra palabra es una ruta).
  apply: { aliases: [], dryRun: true, project: 0, load: () => import('./apply.mjs').then((m) => m.runApply) }
};

// alias → verbo; lo que no es un alias resuelve al verbo por defecto, `apply`. `word` llega ya en
// minúsculas (context.mjs normaliza el primer posicional).
const ALIAS_TO_VERB = Object.fromEntries(Object.entries(VERBS).flatMap(([verb, e]) => e.aliases.map((a) => [a, verb])));
export const verbOf = (word) => ALIAS_TO_VERB[word] || 'apply';
