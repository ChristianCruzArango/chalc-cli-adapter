// i18n.mjs — marco bilingüe del portón (R17). Responsabilidad ÚNICA: redactar. Razón de cambio: los
// textos que el portón muestra.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// Se localiza el MARCO, no la evidencia: rutas, comandos, cifras, códigos de salida y nombres de
// mutador se muestran tal cual salieron de las herramientas. Lo que cambia de idioma es lo que
// escribe chalc. Por eso las etapas emiten `{ rule, data }` y la frase se arma aquí: el mismo
// hallazgo se lee en los dos idiomas sin que ninguna etapa sepa de idiomas.

import { RULES } from './rules.mjs';

// Marco del informe. Paridad exacta de claves entre es y en: el test la exige.
export const FRAME = {
  es: {
    title: 'Portón de calidad',
    branch: 'Rama',
    role: 'Repo',
    spec: 'Spec',
    verdict: { pass: 'APROBADO', fail: 'NO PASA', blocked: 'BLOQUEADO' },
    stages: {
      title: 'Etapas',
      name: 'Etapa', result: 'Resultado', command: 'Comando', code: 'Salida', duration: 'Duración',
      tests: 'tests', mutation: 'mutación', smells: 'código', boundaries: 'fronteras',
      traceability: 'trazabilidad', contract: 'contrato'
    },
    status: {
      passed: 'pasó', failed: 'no pasa', blocked: 'bloqueada',
      skippedFast: 'omitida por --fast', skippedDependency: 'no ejecutada: los tests fallaron',
      notApplicable: 'no aplica en este repo'
    },
    mutation: {
      title: 'Mutación',
      score: 'Score', threshold: 'umbral', killed: 'muertos', survivors: 'sobrevivientes',
      file: 'Archivo', line: 'Línea', mutator: 'Mutador', state: 'Estado'
    },
    findings: { title: 'Hallazgos', file: 'Archivo', line: 'Línea', rule: 'Regla', detail: 'Detalle', none: 'Sin hallazgos.' },
    fast: 'Corrida rápida (`--fast`): la mutación no se ejecutó, así que **no cierra la tarea**.'
  },
  en: {
    title: 'Quality gate',
    branch: 'Branch',
    role: 'Repo',
    spec: 'Spec',
    verdict: { pass: 'PASSED', fail: 'FAILED', blocked: 'BLOCKED' },
    stages: {
      title: 'Stages',
      name: 'Stage', result: 'Result', command: 'Command', code: 'Exit', duration: 'Duration',
      tests: 'tests', mutation: 'mutation', smells: 'code', boundaries: 'boundaries',
      traceability: 'traceability', contract: 'contract'
    },
    status: {
      passed: 'passed', failed: 'failed', blocked: 'blocked',
      skippedFast: 'skipped by --fast', skippedDependency: 'not run: the tests failed',
      notApplicable: 'not applicable in this repo'
    },
    mutation: {
      title: 'Mutation',
      score: 'Score', threshold: 'threshold', killed: 'killed', survivors: 'survivors',
      file: 'File', line: 'Line', mutator: 'Mutator', state: 'State'
    },
    findings: { title: 'Findings', file: 'File', line: 'Line', rule: 'Rule', detail: 'Detail', none: 'No findings.' },
    fast: 'Fast run (`--fast`): mutation did not run, so this **does not close the task**.'
  }
};

// Cómo se nombra el papel del repo frente al contrato: no es lo mismo no exponer una ruta que no
// consumirla, y el verbo correcto es lo que dice al equipo dónde está el desajuste.
const CONTRACT_VERB = {
  es: { back: 'expone', front: 'consume', movil: 'consume', mobile: 'consume', '': 'implementa' },
  en: { back: 'expose', front: 'consume', movil: 'consume', mobile: 'consume', '': 'implement' }
};

const verb = (lang, role) => CONTRACT_VERB[lang][role] ?? CONTRACT_VERB[lang][''];

// Redacción de cada hallazgo a partir de sus datos. Una función por regla y por idioma: el test de
// paridad exige que ninguna regla se quede sin traducir en ninguno de los dos.
export const MESSAGES = {
  es: {
    [RULES.noTestCommand]: () => 'sin comando de tests configurado: completa "test.command" en .chalc/gate.json — sin pruebas no hay nada que verificar',
    [RULES.noTool]: () => 'sin herramienta de mutación configurada para este repo: completa "mutation" en .chalc/gate.json',
    [RULES.notInstalled]: (d) => `la herramienta de mutación no está instalada (${d.tool}); ${d.install ? `instálala con: ${d.install}` : 'instálala antes de cerrar la tarea'}`,
    [RULES.noReport]: (d) => `la herramienta no dejó su reporte en "${d.report}"${d.code ? ` (el comando salió con código ${d.code})` : ''}`,
    [RULES.staleReport]: (d) => `el reporte de mutación es anterior a "${d.source}": mide otra versión del código, vuelve a correr ${d.command}`,
    [RULES.badReport]: (d) => `no se pudo leer el reporte de mutación: ${d.detail}`,
    [RULES.noMutants]: () => 'el reporte no tiene ni un mutante válido: no hay score que evaluar',
    [RULES.mutantSurvived]: (d) => `mutante no detectado (${d.status}${d.mutator ? `, ${d.mutator}` : ''}); score ${d.score}% < ${d.threshold}%`,

    [RULES.onePerFile]: (d) => `"${d.name}" es la declaración pública nº ${d.position} del archivo; va en su propio archivo junto a "${d.first}"`,
    [RULES.typeInService]: (d) => `"${d.name}" se declara dentro de un servicio o componente: va en su propio archivo`,
    [RULES.fileTooLong]: (d) => `${d.lines} líneas (límite ${d.limit}): el archivo hace más de una cosa`,
    [RULES.functionTooLong]: (d) => `"${d.name}" tiene ${d.lines} líneas (límite ${d.limit})`,
    [RULES.tooManyParams]: (d) => `"${d.name}" recibe ${d.params} parámetros (límite ${d.limit}): agrúpalos en un objeto`,
    [RULES.deepNesting]: (d) => `anidamiento de ${d.depth} en "${d.name}" (límite ${d.limit}): extrae o invierte la condición`,
    [RULES.emptyCatch]: () => 'catch vacío: el error se traga sin registrarlo ni propagarlo',
    [RULES.debugOutput]: () => 'salida de depuración olvidada en el código',
    [RULES.anyType]: () => 'tipo sin tipar: anula la comprobación estática justo donde hace falta',

    [RULES.layerBoundary]: (d) => `"${d.from}" importa "${d.to}" (${d.import}): rompe la dirección de las capas`,
    [RULES.featureBoundary]: (d) => `"${d.from}" importa "${d.to}" (${d.import}): los features no se importan entre sí`,

    [RULES.noRequirement]: (d) => `el test no cita ningún requisito de ${d.spec}: sin cita nadie puede saber qué cubre`,
    [RULES.unknownRequirement]: (d) => `"${d.id}" no existe en ${d.spec}: cita un requisito real o actualiza la spec primero`,
    [RULES.contractRouteMissing]: (d, lang) =>
      `${d.method} ${d.path} está en el contrato pero este repo no la ${verb(lang, d.role)}: falta "${d.missing.join('", "')}" en el código`
  },
  en: {
    [RULES.noTestCommand]: () => 'no test command configured: fill in "test.command" in .chalc/gate.json — without tests there is nothing to verify',
    [RULES.noTool]: () => 'no mutation tool configured for this repo: fill in "mutation" in .chalc/gate.json',
    [RULES.notInstalled]: (d) => `the mutation tool is not installed (${d.tool}); ${d.install ? `install it with: ${d.install}` : 'install it before closing the task'}`,
    [RULES.noReport]: (d) => `the tool left no report at "${d.report}"${d.code ? ` (the command exited with code ${d.code})` : ''}`,
    [RULES.staleReport]: (d) => `the mutation report is older than "${d.source}": it measures a different version of the code, run ${d.command} again`,
    [RULES.badReport]: (d) => `the mutation report could not be read: ${d.detail}`,
    [RULES.noMutants]: () => 'the report has not a single valid mutant: there is no score to judge',
    [RULES.mutantSurvived]: (d) => `mutant not detected (${d.status}${d.mutator ? `, ${d.mutator}` : ''}); score ${d.score}% < ${d.threshold}%`,

    [RULES.onePerFile]: (d) => `"${d.name}" is public declaration nº ${d.position} in this file; it belongs in its own file next to "${d.first}"`,
    [RULES.typeInService]: (d) => `"${d.name}" is declared inside a service or component: it belongs in its own file`,
    [RULES.fileTooLong]: (d) => `${d.lines} lines (limit ${d.limit}): the file does more than one thing`,
    [RULES.functionTooLong]: (d) => `"${d.name}" is ${d.lines} lines long (limit ${d.limit})`,
    [RULES.tooManyParams]: (d) => `"${d.name}" takes ${d.params} parameters (limit ${d.limit}): group them into an object`,
    [RULES.deepNesting]: (d) => `nesting of ${d.depth} in "${d.name}" (limit ${d.limit}): extract it or invert the condition`,
    [RULES.emptyCatch]: () => 'empty catch: the error is swallowed without logging or rethrowing it',
    [RULES.debugOutput]: () => 'debug output left behind in the code',
    [RULES.anyType]: () => 'untyped value: it cancels static checking exactly where it is needed',

    [RULES.layerBoundary]: (d) => `"${d.from}" imports "${d.to}" (${d.import}): it breaks the direction of the layers`,
    [RULES.featureBoundary]: (d) => `"${d.from}" imports "${d.to}" (${d.import}): features do not import each other`,

    [RULES.noRequirement]: (d) => `the test cites no requirement from ${d.spec}: without a citation nobody can tell what it covers`,
    [RULES.unknownRequirement]: (d) => `"${d.id}" does not exist in ${d.spec}: cite a real requirement or update the spec first`,
    [RULES.contractRouteMissing]: (d, lang) =>
      `${d.method} ${d.path} is in the contract but this repo does not ${verb(lang, d.role)} it: "${d.missing.join('", "')}" is missing from the code`
  }
};

// El marco del idioma pedido. Sin coincidencia cae a inglés, igual que la precedencia de chalc.
export const frameOf = (lang) => FRAME[lang] || FRAME.en;

// La frase de un hallazgo. Una regla sin redactar devuelve su código: es peor que una frase, pero
// infinitamente mejor que un hueco donde iba un hallazgo.
export function messageOf(rule, data = {}, lang = 'en') {
  const table = MESSAGES[lang] || MESSAGES.en;
  const write = table[rule];
  return write ? write(data, MESSAGES[lang] ? lang : 'en') : rule;
}
