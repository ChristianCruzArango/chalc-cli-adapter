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
  mutantSurvived: 'mutant-survived',

  // una cosa por archivo y smells medibles
  onePerFile: 'one-thing-per-file',
  typeInService: 'type-in-service',
  fileTooLong: 'file-too-long',
  functionTooLong: 'function-too-long',
  tooManyParams: 'too-many-params',
  deepNesting: 'deep-nesting',
  emptyCatch: 'empty-catch',
  debugOutput: 'debug-output',
  anyType: 'any-type',

  // fronteras de arquitectura
  duplication: 'duplication',
  layerBoundary: 'layer-boundary',
  featureBoundary: 'feature-boundary',

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
