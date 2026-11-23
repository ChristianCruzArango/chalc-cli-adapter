// teamstage.mjs — el advisor dentro del worktree de una spec (spec 034, R12). Responsabilidad ÚNICA: saber si el
// repo es el worktree de un desarrollador del equipo y qué cambia ahí. Razón de cambio: la política del equipo.
//
// Este archivo lo emite chalc dentro de `.chalc/next/lib/`. No edites aquí: se regenera al equipar el repo.
//
// En el worktree de una spec trabaja UN desarrollador. No llama a sus propios revisores —quien revisa lo despacha
// el líder sobre la entrega, y un rol nunca lanza a otro— ni pide el cierre: cuando todo está hecho y medido,
// entrega. Fuera de un worktree de equipo nada de esto aplica y el ciclo es el de siempre.

/** ¿Es este repo el worktree de la spec activa? Lo es cuando la rama es `chalc/<carpeta activa>`. */
export const inTeam = (s) => Boolean(s.specs?.dir) && Boolean(s.git?.branch) && s.git.branch === `chalc/${s.specs.dir.split('/').pop()}`;

/** La fila de la entrega: sin tareas pendientes y con evidencia del portón, el desarrollador entrega. */
export const DELIVER_ROW = {
  action: 'deliver_spec',
  when: (s) => s.gate.exists && inTeam(s),
  facts: (s) => ({ dir: s.specs.dir, total: s.tasks.total })
};
