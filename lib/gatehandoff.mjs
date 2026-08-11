// lib/gatehandoff.mjs — el ciclo de cierre de tarea que va en los hand-offs (spec 007 R13,
// reemplazado por spec 008 R19). Responsabilidad ÚNICA: redactar ese ciclo. Razón de cambio: cómo
// se cierra una tarea.
//
// Hasta la spec 007 esto era una lista numerada: corre el portón, pega su salida, llama al revisor,
// marca la tarea, espera el OK. El problema no era la lista, era quién la recordaba. El asistente
// decidía solo si ya la había cumplido, y el único que atraparía el olvido era el revisor — al que
// también invocaba él.
//
// Ahora el hand-off dice una sola cosa: consulta el advisor y obedece. Quien lleva la cuenta del
// punto en que va la tarea es el disco —la fecha de la evidencia, el veredicto del portón, la
// bitácora del revisor, los checkboxes de tasks.md— y no la memoria de nadie. La lista sigue
// existiendo, pero la recorre un script que no se cansa ni se salta pasos.

const NEXT_DEFAULT = '.chalc/next.mjs';
const GATE_DEFAULT = '.chalc/gate.mjs';

// El ciclo de una tarea, sobre el advisor de `nextPath`. Devuelve líneas (el llamador las numera o
// las inserta donde le convenga).
export function advisorCycle({ en = false, nextPath = NEXT_DEFAULT } = {}) {
  if (en) {
    return [
      `Closing a task — the advisor decides the order, not you:`,
      `   a. Run \`node ${nextPath}\`. It prints \`NEXT_ACTION\`, \`REASON\` and \`COMMAND\`.`,
      `   b. Do exactly what \`NEXT_ACTION\` says; if \`COMMAND\` is not empty, run it verbatim.`,
      `   c. Ask again. Repeat until it answers \`done\`.`,
      `   Do not decide the next step yourself, and do not skip an action because it "looks unnecessary":`,
      `   the advisor reads the real state of the repo — evidence dates, gate verdict, reviewer log, tasks.md.`,
      `   \`ask_human\` is the only answer that stops the loop: it means the advisor cannot tell where this stands.`,
      `   Stop there and tell me what it reported.`
    ];
  }
  return [
    `Cierre de cada tarea — el orden lo decide el advisor, no tú:`,
    `   a. Corre \`node ${nextPath}\`. Imprime \`NEXT_ACTION\`, \`REASON\` y \`COMMAND\`.`,
    `   b. Haz exactamente lo que diga \`NEXT_ACTION\`; si \`COMMAND\` no está vacío, ejecútalo tal cual.`,
    `   c. Vuelve a preguntarle. Repite hasta que responda \`done\`.`,
    `   No decidas tú el siguiente paso, y no te saltes una acción porque "parezca innecesaria":`,
    `   el advisor lee el estado real del repo — fechas de la evidencia, veredicto del portón, bitácora del revisor, tasks.md.`,
    `   \`ask_human\` es la única respuesta que corta el bucle: significa que no puede saber en qué punto va esto.`,
    `   Párate ahí y cuéntame lo que reportó.`
  ];
}

// El mismo ciclo cuando la feature toca varios repos. Cada lado tiene SU advisor y SU portón: el del
// back mide el contrato que expone y el del front el que consume, así que cerrar uno no dice nada
// del otro.
export function advisorCycleMulti({ en = false, repos = [] } = {}) {
  const list = repos.map((r) => `   - ${r.label}: \`node ${r.nextPath}\``);
  if (en) {
    return [
      `Closing a task — the advisor of the repo you are working in decides the order, not you:`,
      ...list,
      `   a. Run the advisor OF THAT REPO. It prints \`NEXT_ACTION\`, \`REASON\` and \`COMMAND\`.`,
      `   b. Do what \`NEXT_ACTION\` says; if \`COMMAND\` is not empty, run it verbatim.`,
      `   c. Ask again. Repeat until it answers \`done\` for that repo.`,
      `   Do not switch repos until the current one answers \`done\`.`,
      `   \`ask_human\` is the only answer that stops the loop: stop there and tell me what it reported.`
    ];
  }
  return [
    `Cierre de cada tarea — el orden lo decide el advisor del repo en el que estás, no tú:`,
    ...list,
    `   a. Corre el advisor DE ESE REPO. Imprime \`NEXT_ACTION\`, \`REASON\` y \`COMMAND\`.`,
    `   b. Haz lo que diga \`NEXT_ACTION\`; si \`COMMAND\` no está vacío, ejecútalo tal cual.`,
    `   c. Vuelve a preguntarle. Repite hasta que responda \`done\` para ese repo.`,
    `   No cambies de repo hasta que el actual responda \`done\`.`,
    `   \`ask_human\` es la única respuesta que corta el bucle: párate ahí y cuéntame lo que reportó.`
  ];
}

// La ruta del advisor de un repo, tal como se invoca desde donde trabaja el asistente.
export const nextPathOf = (repoPath) => (repoPath ? `${String(repoPath).replace(/[/\\]+$/, '')}/${NEXT_DEFAULT}` : NEXT_DEFAULT);

// La ruta del portón de un repo. La sigue usando el advisor al resolver el `COMMAND` de `run_gate`,
// y los hand-offs para nombrar el portón cuando hace falta.
export const gatePathOf = (repoPath) => (repoPath ? `${String(repoPath).replace(/[/\\]+$/, '')}/${GATE_DEFAULT}` : GATE_DEFAULT);
