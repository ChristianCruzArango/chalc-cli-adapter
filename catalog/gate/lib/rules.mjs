// rules.mjs — el vocabulario de hallazgos del portón. Responsabilidad ÚNICA: nombrar cada cosa que
// el portón sabe reportar. Razón de cambio: que aparezca o desaparezca una comprobación.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// Los códigos viven en UN solo sitio porque son el contrato entre las etapas (que los emiten), el
// marco bilingüe (que los redacta) y la evidencia (que los agrupa). Con la lista aquí, el test de
// paridad puede exigir que toda regla emitida tenga redacción en los dos idiomas — si estuvieran
// esparcidos como literales, estrenar una regla sin traducirla pasaría desapercibido.

export const RULES = Object.freeze({
  // etapa de tests
  noTestCommand: 'no-test-command',

  // etapa de compilación (spec 018)
  buildFailed: 'build-failed',
  buildNotInstalled: 'build-not-installed',

  // etapa de mutación
  noTool: 'no-tool',
  notInstalled: 'not-installed',
  noReport: 'no-report',
  staleReport: 'stale-report',
  badReport: 'bad-report',
  noMutants: 'no-mutants',
  unsafePath: 'unsafe-path',
  mutantSurvived: 'mutant-survived',

  // una cosa por archivo y smells medibles
  onePerFile: 'one-thing-per-file',
  typeInService: 'type-in-service',
  fileTooLong: 'file-too-long',
  functionTooLong: 'function-too-long',
  // Demasiados caminos en una función (spec 031, R6).
  functionTooComplex: 'function-too-complex',
  // Algo que YA superaba el límite y la tarea hizo crecer (G-03, R40): la deuda no es suya, el crecimiento sí.
  oversizedGrew: 'oversized-grew',
  tooManyParams: 'too-many-params',
  deepNesting: 'deep-nesting',
  emptyCatch: 'empty-catch',
  debugOutput: 'debug-output',
  anyType: 'any-type',

  // fronteras de arquitectura
  duplication: 'duplication',
  layerBoundary: 'layer-boundary',
  featureBoundary: 'feature-boundary',
  // Un archivo nuevo fuera de las carpetas de la arquitectura acordada (spec 031, R3).
  fileOutsideStructure: 'file-outside-structure',

  // seguridad (spec 014). Solo señales que se pueden afirmar con archivo y línea; lo que pide
  // entender el código —autorización, sesión, qué dato es sensible— es del rol `seguridad`.
  hardcodedSecret: 'hardcoded-secret',
  tlsDisabled: 'tls-disabled',
  insecureTransport: 'insecure-transport',
  sqlConcat: 'sql-concat',
  dynamicEval: 'dynamic-eval',
  unsafeHtml: 'unsafe-html',
  weakHash: 'weak-hash',
  allowWithoutReason: 'allow-without-reason',

  // el alcance de la revisión (spec 013). Las dos únicas reglas que no hablan del código sino de la
  // propia revisión: no se pudo saber QUÉ revisar, o no había NADA que revisar. Se parecen y son
  // opuestas — una es duda y bloquea, la otra es un hecho y se informa.
  scopeUndetermined: 'scope-undetermined',
  scopeEmpty: 'scope-empty',
  // Un comando del portón (test/build/mutation) cambió desde lo sellado: no se ejecuta hasta re-sellar.
  commandsUnsealed: 'commands-unsealed',
  // Una herramienta de `.chalc/` no coincide con su manifiesto de integridad (spec 029, R8).
  toolingAltered: 'tooling-altered',

  // Test-First con evidencia (spec 030): el rojo de la tarea y sus tests sellados.
  noRed: 'no-red',
  redSkippedWithCode: 'red-skipped-with-code',
  sealedTestChanged: 'sealed-test-changed',
  // Tests que no prueban nada (spec 030, R9).
  testSkipped: 'test-skipped',
  testFocused: 'test-focused',
  testTrivialAssert: 'test-trivial-assert',
  testNoAssert: 'test-no-assert',

  // trazabilidad y contrato
  noRequirement: 'no-requirement',
  unknownRequirement: 'unknown-requirement',
  requirementUntested: 'requirement-untested',
  contractRouteMissing: 'contract-route-missing',

  // coherencia HU ↔ spec ↔ plan ↔ tareas de la carpeta activa (spec 024). No hablan del código: dicen por
  // qué todavía no se puede pasar a tests ni a código.
  activeSpecInvalid: 'active-spec-invalid',
  specFileMissing: 'spec-file-missing',
  huEmpty: 'hu-empty',
  huNoSource: 'hu-no-source',
  huNoFragments: 'hu-no-fragments',
  huFragmentNotLiteral: 'hu-fragment-not-literal',
  huChanged: 'hu-changed',
  huUncited: 'hu-uncited',
  specNoRequirements: 'spec-no-requirements',
  requirementNotEars: 'requirement-not-ears',
  needsClarification: 'needs-clarification',
  requirementNoHu: 'requirement-no-hu',
  requirementUnknownHu: 'requirement-unknown-hu',
  requirementUncovered: 'requirement-uncovered',
  planUnknownRequirement: 'plan-unknown-requirement',
  taskNoRequirement: 'task-no-requirement',
  taskUnknownRequirement: 'task-unknown-requirement',
  tasksEmpty: 'tasks-empty',
  specNotApproved: 'spec-not-approved',
  // Una spec con interfaz (Superficie: ui) necesita su design.md (spec 038, R7).
  designMissing: 'design-missing',
  // Una spec de API o de CLI necesita sus sondas, y que valgan (spec 041, R6).
  probesMissing: 'probes-missing',
  probesInvalid: 'probes-invalid',

  // la guarda del asistente (spec 017). No son hallazgos de una revisión sino el motivo de una acción
  // que se pregunta o se bloquea ANTES de ocurrir; viven aquí para que su redacción tenga la misma
  // exigencia de paridad que el resto.
  guardGitCommit: 'git-commit',
  guardGitPush: 'git-push',
  guardGitPushForce: 'git-push-force',
  guardSecretRead: 'secret-read',
  guardSecretGrep: 'secret-grep',
  guardDeleteOutside: 'delete-outside',
  // La aprobación de la spec es del usuario (spec 024, R15): el asistente no ejecuta `--approve-*`.
  guardApprove: 'approve-by-assistant',
  // La fusión de la rama de integración es la aprobación del cierre: del usuario (spec 035, R11).
  guardIntegrationMerge: 'integration-merge-by-assistant',
  // Saltarse los hooks de git es decisión de una persona (spec 029, R6).
  guardNoVerify: 'git-no-verify'
});
