// text.mjs — lo que la línea de comandos de la memoria dice, en el idioma del proyecto (`language`
// de .chalc/gate.json), igual que el portón: paridad exacta de claves entre es y en.

const TEXT = {
  es: {
    usage: [
      'Uso:',
      '  node .chalc/memory.mjs search <palabras>   reglas y decisiones que responden (como mucho 8)',
      '  node .chalc/memory.mjs get <id>            el detalle completo de una entrada',
      '  node .chalc/memory.mjs concepts            los conceptos existentes, para escribir una spec',
      '  node .chalc/memory.mjs capture             guarda lo aprendido al cerrar una tarea',
      '  node .chalc/memory.mjs compact             deja solo la versión vigente de cada entrada',
      '  node .chalc/memory.mjs candidates          lo que se repitió y espera tu decisión',
      '  node .chalc/memory.mjs promote <id>        la hace regla de todo el equipo (solo desde tu terminal)',
      '  node .chalc/memory.mjs demote <id>         la retira de las reglas del equipo (solo desde tu terminal)'
    ].join('\n'),
    nothingFound: 'Nada en la memoria sobre eso.',
    noEntry: (id) => `No hay ninguna entrada con id ${id}.`,
    captured: (rules, decisions) => `Memoria: ${rules} regla(s) y ${decisions} decisión(es) capturadas.`,
    compacted: 'Memoria compactada.',
    notNeeded: 'No hacía falta compactar.',
    noCandidates: 'Nada se ha repetido todavía.',
    needsTerminal: 'Promover o retirar una lección la decide el usuario: ejecútalo en una terminal interactiva.',
    promotedFull: (max) => `Ya hay ${max} lecciones promovidas, el tope: retira alguna (demote) antes de promover otra.`,
    promoted: (id) => `${id} es ahora regla de todo el equipo: va en cada orden.`,
    demoted: (id) => `${id} ya no es regla de todo el equipo.`
  },
  en: {
    usage: [
      'Usage:',
      '  node .chalc/memory.mjs search <words>      rules and decisions that answer (at most 8)',
      '  node .chalc/memory.mjs get <id>            the full detail of an entry',
      '  node .chalc/memory.mjs concepts            the existing concepts, to write a spec',
      '  node .chalc/memory.mjs capture             saves what was learned when closing a task',
      '  node .chalc/memory.mjs compact             keeps only the current version of each entry',
      '  node .chalc/memory.mjs candidates          what was repeated and waits for your decision',
      '  node .chalc/memory.mjs promote <id>        makes it a rule for the whole team (only from your terminal)',
      '  node .chalc/memory.mjs demote <id>         removes it from the team rules (only from your terminal)'
    ].join('\n'),
    nothingFound: 'Nothing in memory about that.',
    noEntry: (id) => `There is no entry with id ${id}.`,
    captured: (rules, decisions) => `Memory: ${rules} rule(s) and ${decisions} decision(s) captured.`,
    compacted: 'Memory compacted.',
    notNeeded: 'No compaction was needed.',
    noCandidates: 'Nothing has been repeated yet.',
    needsTerminal: 'Promoting or removing a lesson is decided by the user: run it in an interactive terminal.',
    promotedFull: (max) => `There are already ${max} promoted lessons, the cap: remove one (demote) before promoting another.`,
    promoted: (id) => `${id} is now a rule for the whole team: it goes in every order.`,
    demoted: (id) => `${id} is no longer a rule for the whole team.`
  }
};

export const textOf = (lang) => TEXT[lang] || TEXT.en;
export const LANGS = Object.keys(TEXT);
