// i18n-tdd.mjs — lo que dice el registro del rojo (spec 030). Responsabilidad ÚNICA: sus textos en es y en.
// Razón de cambio: la redacción.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// Vive aparte de `i18n.mjs` solo por tamaño; `FRAME` lo incluye, así que la paridad de claves se exige igual.

import { RULES } from './rules.mjs';

export const TDD = {
  es: {
    red: {
      done: (task, count) => `Rojo registrado para ${task}: ${count} archivo(s) de test sellados. Ahora sí, el código mínimo para pasarlos.`,
      skipped: (task, reason) => `Registrado que ${task} no lleva tests: ${reason}`,
      noTask: 'No hay ninguna tarea en curso en tasks.md: no hay rojo que registrar.',
      noTests: 'La tarea no ha cambiado ningún archivo de test: escribe primero los tests de sus criterios.',
      testsPass: 'Los tests PASAN: eso no es un rojo. Un test que no falla antes del código no prueba nada; si es una tarea sin tests, usa --skip "<motivo>".',
      codeFirst: (files) => `Ya hay código de producción cambiado (${files.join(', ')}): los tests van ANTES. Deshaz ese código, registra el rojo y vuelve a escribirlo.`,
      noTestCommand: 'No hay comando de tests configurado: completa "test.command" en .chalc/gate.json.',
      scopeUndetermined: 'No se puede saber qué archivos cambió esta tarea (no hay repo de git ni registro de rutas escritas).',
      skipReason: 'La exención necesita un motivo de al menos tres palabras: --skip "<por qué esta tarea no lleva tests>".'
    }
  },
  en: {
    red: {
      done: (task, count) => `Red registered for ${task}: ${count} test file(s) sealed. Now the minimum code to pass them.`,
      skipped: (task, reason) => `Registered that ${task} carries no tests: ${reason}`,
      noTask: 'There is no task in progress in tasks.md: there is no red to register.',
      noTests: 'The task has changed no test file: write the tests for its criteria first.',
      testsPass: 'The tests PASS: that is not a red. A test that does not fail before the code proves nothing; if the task has no tests, use --skip "<reason>".',
      codeFirst: (files) => `Production code has already changed (${files.join(', ')}): tests come FIRST. Undo that code, register the red and write it again.`,
      noTestCommand: 'No test command is configured: fill in "test.command" in .chalc/gate.json.',
      scopeUndetermined: 'It cannot be known which files this task changed (no git repo and no record of written paths).',
      skipReason: 'The waiver needs a reason of at least three words: --skip "<why this task carries no tests>".'
    }
  }
};

// Los hallazgos de la etapa `tdd` (spec 030, R5, R6).
export const TDD_MESSAGES = {
  es: {
    [RULES.noRed]: (d) => `la tarea ${d.task} cambió código de producción sin un rojo registrado: los tests van antes. Deshaz el código, escribe los tests y regístralos con \`node .chalc/gate.mjs --red\``,
    [RULES.redSkippedWithCode]: (d) => `la tarea ${d.task} se declaró sin tests («${d.reason}») y aun así cambió código de producción: escribe sus tests y regístralos con \`node .chalc/gate.mjs --red\``,
    [RULES.requirementUntested]: (d) => `ningún test de la tarea ${d.task} cita ${d.id}: un requisito sin test no está probado. Escribe su test (y cítalo)`,
    [RULES.testSkipped]: () => 'test saltado: no corre, así que no prueba nada. Actívalo o bórralo',
    [RULES.testFocused]: () => 'test enfocado (only): deja sin correr a todos los demás. Quita el foco',
    [RULES.testTrivialAssert]: () => 'aserción trivial: compara una constante consigo misma y pasaría con el código roto',
    [RULES.testNoAssert]: () => 'este caso de test no afirma nada: sin una aserción pasa aunque el código esté roto',
    [RULES.sealedTestChanged]: () => 'este test se selló en el rojo y después cambió o desapareció: reviértelo, o hazlo fallar de nuevo y vuelve a registrarlo con `node .chalc/gate.mjs --red` (un test no se afloja para que pase)'
  },
  en: {
    [RULES.noRed]: (d) => `task ${d.task} changed production code with no red registered: tests come first. Undo the code, write the tests and register them with \`node .chalc/gate.mjs --red\``,
    [RULES.redSkippedWithCode]: (d) => `task ${d.task} was declared to carry no tests ("${d.reason}") and still changed production code: write its tests and register them with \`node .chalc/gate.mjs --red\``,
    [RULES.requirementUntested]: (d) => `no test of task ${d.task} cites ${d.id}: a requirement without a test is not proven. Write its test (and cite it)`,
    [RULES.testSkipped]: () => 'skipped test: it does not run, so it proves nothing. Enable it or delete it',
    [RULES.testFocused]: () => 'focused test (only): it keeps every other test from running. Remove the focus',
    [RULES.testTrivialAssert]: () => 'trivial assertion: it compares a constant with itself and would pass with the code broken',
    [RULES.testNoAssert]: () => 'this test case asserts nothing: without an assertion it passes even if the code is broken',
    [RULES.sealedTestChanged]: () => 'this test was sealed at the red and then changed or disappeared: revert it, or make it fail again and re-register it with `node .chalc/gate.mjs --red` (a test is not loosened so that it passes)'
  }
};
