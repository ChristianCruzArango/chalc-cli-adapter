// prior.mjs — los hallazgos previos de una entrada de la bitácora (spec 017, R8). Responsabilidad
// ÚNICA: decir qué hallazgos de la pasada anterior de un rol tiene que cerrar su entrada nueva. Razón de
// cambio: qué cuenta como «la pasada anterior».
//
// Este archivo lo emite chalc dentro de `.chalc/next/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// Cada entrada responde a la ANTERIOR del mismo rol. Si aquella dejó `FINDINGS: n`, esta tiene que
// decir qué pasó con cada uno; si fue `OK`, no hay nada pendiente. Sin esto, un rol que vuelve a
// revisar empieza de cero, y un hallazgo que no vio la segunda vez desaparece sin que nadie lo cierre.
//
// No se corta por la línea base de la tarea: el portón la vuelve a sellar en cada corrida aprobada con un
// HEAD nuevo, antes de que pasen los roles, y un commit entre dos pasadas del revisor dejaría sus
// hallazgos «antes de la base» sin que nadie los exigiera (encontrado en el E2E de la spec 017). Tampoco
// hace falta: una tarea solo cierra con `OK` de cada rol, así que nada de una tarea cerrada se arrastra.
// Puro: recibe las entradas ya leídas.

/** Los hallazgos `[{ n, text }]` de la entrada anterior del mismo rol, si fue `FINDINGS`; si no, []. */
export function priorFindings(entries, entry) {
  if (!entry) return [];
  const previous = (entries || [])
    .filter((e) => e.role === entry.role && e.date < entry.date)
    .at(-1);
  return previous && !previous.ok ? previous.items : [];
}
