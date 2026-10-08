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
      '  node .chalc/memory.mjs compact             deja solo la versión vigente de cada entrada'
    ].join('\n'),
    nothingFound: 'Nada en la memoria sobre eso.',
    noEntry: (id) => `No hay ninguna entrada con id ${id}.`,
    captured: (rules, decisions) => `Memoria: ${rules} regla(s) y ${decisions} decisión(es) capturadas.`,
    compacted: 'Memoria compactada.',
    notNeeded: 'No hacía falta compactar.'
  },
  en: {
    usage: [
      'Usage:',
      '  node .chalc/memory.mjs search <words>      rules and decisions that answer (at most 8)',
      '  node .chalc/memory.mjs get <id>            the full detail of an entry',
      '  node .chalc/memory.mjs concepts            the existing concepts, to write a spec',
      '  node .chalc/memory.mjs capture             saves what was learned when closing a task',
      '  node .chalc/memory.mjs compact             keeps only the current version of each entry'
    ].join('\n'),
    nothingFound: 'Nothing in memory about that.',
    noEntry: (id) => `There is no entry with id ${id}.`,
    captured: (rules, decisions) => `Memory: ${rules} rule(s) and ${decisions} decision(s) captured.`,
    compacted: 'Memory compacted.',
    notNeeded: 'No compaction was needed.'
  }
};

export const textOf = (lang) => TEXT[lang] || TEXT.en;
export const LANGS = Object.keys(TEXT);
