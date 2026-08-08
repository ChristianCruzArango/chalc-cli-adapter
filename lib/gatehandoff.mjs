// lib/gatehandoff.mjs — el ciclo de cierre de tarea que va en los hand-offs (spec 007, R13).
// Responsabilidad ÚNICA: redactar ese ciclo. Razón de cambio: cómo se cierra una tarea.
//
// Todo lo que hace el portón es inútil si el asistente no sabe que existe: el hand-off es el único
// texto que lee antes de empezar. Aquí se dice, en el idioma del spec, qué hay que hacer al terminar
// cada tarea y qué NO se puede hacer hasta que el portón y el revisor den verde.
//
// El paso que decide si todo esto funciona es "pega la salida del portón". Sin él, el asistente puede
// correr el portón y contar lo que quiera; con él, la evidencia entra en la conversación tal cual, y
// cualquier discrepancia entre lo que dice y lo que muestra queda a la vista.

const GATE_DEFAULT = '.chalc/gate.mjs';

// El ciclo de una tarea, sobre el portón de `gatePath`. Devuelve líneas (el llamador las numera o
// las inserta donde le convenga).
export function closingCycle({ en = false, gatePath = GATE_DEFAULT } = {}) {
  if (en) {
    return [
      `Closing a task (mandatory, in this order):`,
      `   a. Run the gate: \`node ${gatePath}\`. It runs the tests, the mutation tool and the static linters, and writes the evidence to \`.chalc/gate.md\`.`,
      `   b. Paste its output here, verbatim. Do not summarise or interpret it: the score and the findings come from that run, not from you.`,
      `   c. If it exits non-zero, fix what it reports and run it again. Do NOT move on to the next task.`,
      `   d. Then call the \`revisor\` reviewer agent. If it returns findings, fix them and go back to (a).`,
      `   e. Only then tick the task in \`tasks.md\` and wait for my OK.`,
      `   A \`--fast\` run does NOT close a task: it skips mutation testing on purpose.`
    ];
  }
  return [
    `Cierre de cada tarea (obligatorio, en este orden):`,
    `   a. Corre el portón: \`node ${gatePath}\`. Ejecuta los tests, la herramienta de mutación y los linters estáticos, y escribe la evidencia en \`.chalc/gate.md\`.`,
    `   b. Pega su salida aquí, tal cual. No la resumas ni la interpretes: el score y los hallazgos salen de esa corrida, no de ti.`,
    `   c. Si sale con código distinto de cero, arregla lo que reporta y vuelve a correrlo. NO avances a la siguiente tarea.`,
    `   d. Después llama al agente revisor \`revisor\`. Si devuelve hallazgos, arréglalos y vuelve a (a).`,
    `   e. Solo entonces marca la tarea en \`tasks.md\` y espera mi OK.`,
    `   Una corrida con \`--fast\` NO cierra tarea: omite la mutación a propósito.`
  ];
}

// El mismo ciclo cuando la feature toca varios repos. Cada lado tiene SU portón: el del back mide el
// contrato que expone y el del front el que consume, así que cerrar uno no dice nada del otro.
export function closingCycleMulti({ en = false, repos = [] } = {}) {
  const list = repos.map((r) => `   - ${r.label}: \`node ${r.gatePath}\``);
  if (en) {
    return [
      `Closing a task (mandatory, in this order):`,
      `   a. Run the gate OF THE REPO you just worked in:`,
      ...list,
      `   b. Paste its output here, verbatim. Do not summarise or interpret it: the score and the findings come from that run, not from you.`,
      `   c. If it exits non-zero, fix what it reports and run it again.`,
      `   d. Then call the \`revisor\` reviewer agent in that repo. If it returns findings, fix them and go back to (a).`,
      `   e. Only then tick the task and wait for my OK. Do NOT switch repos, and do not move on to the next task, until the current repo's cycle is closed.`,
      `   A \`--fast\` run does NOT close a task: it skips mutation testing on purpose.`
    ];
  }
  return [
    `Cierre de cada tarea (obligatorio, en este orden):`,
    `   a. Corre el portón DEL REPO en el que acabas de trabajar:`,
    ...list,
    `   b. Pega su salida aquí, tal cual. No la resumas ni la interpretes: el score y los hallazgos salen de esa corrida, no de ti.`,
    `   c. Si sale con código distinto de cero, arregla lo que reporta y vuelve a correrlo.`,
    `   d. Después llama al agente revisor \`revisor\` en ese repo. Si devuelve hallazgos, arréglalos y vuelve a (a).`,
    `   e. Solo entonces marca la tarea y espera mi OK. No cambies de repo, ni pases a la siguiente tarea, hasta cerrar el ciclo del repo actual.`,
    `   Una corrida con \`--fast\` NO cierra tarea: omite la mutación a propósito.`
  ];
}

// La ruta del portón de un repo, tal como se invoca desde donde trabaja el asistente.
export const gatePathOf = (repoPath) => (repoPath ? `${String(repoPath).replace(/[/\\]+$/, '')}/${GATE_DEFAULT}` : GATE_DEFAULT);
