// i18n.mjs — los textos de los evals activos en es y en (spec 042). Responsabilidad ÚNICA: lo que lee una persona
// al preparar, puntuar y comparar. Razón de cambio: la redacción. Paridad exacta de claves.
//
// Este archivo lo emite chalc dentro de `.chalc/evals/lib/`. No edites aquí: se regenera al equipar el repo.

export const MESSAGES = {
  es: {
    usage: 'Uso: node .chalc/evals.mjs list | prepare <caso> --out <carpeta> | score <caso> --dir <carpeta> [--label <etiqueta>] | compare',
    unknownCase: (id) => `No hay ningún caso «${id}». Míralos con: node .chalc/evals.mjs list`,
    notEmpty: (dir) => `La carpeta ${dir} ya tiene contenido: un caso se prepara en una carpeta nueva o vacía.`,
    prepared: (id, dir) => `Caso ${id} preparado en ${dir}. Corre ahí al rol o al modelo que quieres evaluar con el encargo de TASK.md, y después: node .chalc/evals.mjs score ${id} --dir ${dir} --label "<qué evalúas>"`,
    task: 'Encargo',
    trap: 'Trampa',
    total: 'Total',
    skippedNote: (count) => `${count} comprobación(es) omitida(s): no cuentan ni a favor ni en contra.`,
    savedIn: 'Corrida guardada en .chalc/evals-out/results.jsonl',
    noRuns: 'Todavía no hay ninguna corrida puntuada.',
    noLabel: '(sin etiqueta)',
    columns: { label: 'etiqueta', case: 'caso', runs: 'corridas', average: 'media' },
    statuses: { pass: 'cumple', fail: 'no cumple', skipped: 'omitida' }
  },
  en: {
    usage: 'Usage: node .chalc/evals.mjs list | prepare <case> --out <folder> | score <case> --dir <folder> [--label <label>] | compare',
    unknownCase: (id) => `There is no case "${id}". See them with: node .chalc/evals.mjs list`,
    notEmpty: (dir) => `The folder ${dir} already has content: a case is prepared in a new or empty folder.`,
    prepared: (id, dir) => `Case ${id} prepared in ${dir}. Run there the role or model you want to evaluate with the task in TASK.md, and then: node .chalc/evals.mjs score ${id} --dir ${dir} --label "<what you evaluate>"`,
    task: 'Task',
    trap: 'Trap',
    total: 'Total',
    skippedNote: (count) => `${count} check(s) skipped: they count neither for nor against.`,
    savedIn: 'Run saved in .chalc/evals-out/results.jsonl',
    noRuns: 'No run has been scored yet.',
    noLabel: '(no label)',
    columns: { label: 'label', case: 'case', runs: 'runs', average: 'average' },
    statuses: { pass: 'pass', fail: 'fail', skipped: 'skipped' }
  }
};

/** Los textos de `lang`; un idioma desconocido cae al inglés. */
export const textOf = (lang) => MESSAGES[lang] || MESSAGES.en;
