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

  // trazabilidad y contrato
  noRequirement: 'no-requirement',
  unknownRequirement: 'unknown-requirement',
  contractRouteMissing: 'contract-route-missing'
});
