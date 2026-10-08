// report-error.mjs — un reporte de mutación que no se puede leer. Lleva un CÓDIGO (`problem`), no una
// frase: la frase la pone el informe en el idioma del proyecto (i18n.mjs → reportProblems).
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí.

export class ReportError extends Error {
  constructor(problem) {
    super(`mutation report: ${problem}`);
    this.problem = problem;
  }
}
