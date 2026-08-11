// i18n.mjs — marco bilingüe del advisor (spec 008, R5, R10). Responsabilidad ÚNICA: redactar el
// motivo. Razón de cambio: los textos que el advisor muestra.
//
// Este archivo lo emite chalc dentro de `.chalc/next/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// El reparto es lo importante: `NEXT_ACTION` y `COMMAND` NO pasan por aquí. Son contrato de máquina
// —el asistente compara el identificador y ejecuta el comando— y traducirlos rompería el contrato
// en cuanto alguien cambiara el idioma del spec. Lo que se traduce es el motivo, que lo lee una
// persona.
//
// Y el motivo tiene que CITAR el dato que produjo la acción (R10). "Corre el portón" repite el
// nombre del estado y no informa de nada; "la evidencia es de las 14:00 y tocaste código a las
// 15:00" dice qué pasó y deja verificarlo.

// Hora local corta, para situar al lector sin llenar la línea de precisión inútil.
const at = (ms) => {
  if (!ms) return '—';
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const list = (items) => (items || []).join(', ');

// Por qué caducó la evidencia: cuatro causas distintas que exigen cuatro motivos distintos, porque
// el arreglo de cada una es distinto para quien lee.
//
// "Nunca se midió" va PRIMERO y no es un detalle de orden. Cuando no hay estado del portón,
// `parseGateState` devuelve `fast: true` como defecto seguro — correcto para decidir, porque ante la
// duda no se cierra tarea, pero al redactar convertiría la ausencia de evidencia en una afirmación
// falsa sobre una corrida que nunca ocurrió. Y da igual el resto: si no hay evidencia, no hay nada
// que haya caducado por rama ni por edad.
const staleReason = (f, texts) => {
  if (f.evidenceDate === null) return texts.never(f);
  if (f.otherBranch) return texts.otherBranch(f);
  if (f.fast) return texts.fast(f);
  return texts.aged(f);
};

// Marco del advisor. Paridad exacta de claves entre es y en: el test la exige.
export const FRAME = {
  es: {
    reason: {
      blocked_config: (f) => `.chalc/gate.json está incompleto: falta ${list(f.pending)}. El portón no puede medir sin eso.`,
      sync_contract: (f) => `El contrato de \`${f.owner}\` cambió y tu copia quedó vieja (${f.lines} línea(s) de diferencia). `
        + `Mira QUÉ cambió antes de seguir: implementar contra el contrato viejo se descubre al integrar.`,
      read_mail: (f) => `Tienes ${f.unread} aviso(s) sin leer de ${list(f.from)}. Léelos antes de seguir: `
        + `pueden decir justamente que lo que ibas a hacer ya no aplica.`,
      run_gate: (f) => staleReason(f, {
        otherBranch: (x) => `La última evidencia es de la rama \`${x.otherBranch}\`, no de esta: no dice nada del código de aquí.`,
        fast: () => `La última evidencia salió de una corrida \`--fast\`, que omite la mutación a propósito y no cierra tarea.`,
        never: (x) => `Hay ${x.files} archivo(s) cambiado(s) y todavía ninguna evidencia.`,
        aged: (x) => `Tocaste código a las ${at(x.newestMtime)} y la evidencia es de las ${at(x.evidenceDate)}: mide lo de antes.`
      }),
      fix_gate: (f) => `La evidencia de las ${at(f.evidenceDate)} salió con veredicto \`${f.verdict}\`. Arregla lo que reporta .chalc/gate.md.`,
      call_role: (f) => `El portón aprobó a las ${at(f.evidenceDate)} y falta que pase el agente \`${f.role}\``
        + (f.cadence === 'feature' ? ' antes de dar la feature por terminada.' : ' por esta tarea.'),
      fix_review: (f) => `El agente \`${f.role}\` dejó ${f.findings} hallazgo(s) a las ${at(f.reviewDate)} en .chalc/review.md.`,
      tick_task: (f) => `Portón verde y revisión limpia: marca «${f.task}» en tasks.md (${f.done + 1}/${f.total}).`
        + (f.waitForApproval ? ' Después PARA y espera mi OK antes de seguir.' : ''),
      work_task: (f) => `Toca «${f.task}» (${f.done}/${f.total} hechas). TDD estricto: test que falla, código mínimo, refactor.`,
      done: (f) => `Las ${f.total} tareas están marcadas. La feature terminó.`,
      ask_human: (f) => `No puedo saber en qué punto va esto: ${list(f.problems)}. Dímelo tú en vez de que yo lo adivine.`
    }
  },
  en: {
    reason: {
      blocked_config: (f) => `.chalc/gate.json is incomplete: ${list(f.pending)} missing. The gate cannot measure without it.`,
      sync_contract: (f) => `The \`${f.owner}\` contract changed and your copy is stale (${f.lines} line(s) apart). `
        + `Look at WHAT changed before moving on: coding against the old contract only shows up at integration.`,
      read_mail: (f) => `You have ${f.unread} unread note(s) from ${list(f.from)}. Read them before moving on: `
        + `they may say that what you were about to do no longer applies.`,
      run_gate: (f) => staleReason(f, {
        otherBranch: (x) => `The last evidence is from branch \`${x.otherBranch}\`, not this one: it says nothing about the code here.`,
        fast: () => `The last evidence came from a \`--fast\` run, which skips mutation on purpose and does not close a task.`,
        never: (x) => `There are ${x.files} changed file(s) and no evidence yet.`,
        aged: (x) => `You touched code at ${at(x.newestMtime)} and the evidence is from ${at(x.evidenceDate)}: it measures the old code.`
      }),
      fix_gate: (f) => `The evidence from ${at(f.evidenceDate)} came out \`${f.verdict}\`. Fix what .chalc/gate.md reports.`,
      call_role: (f) => `The gate passed at ${at(f.evidenceDate)} and the \`${f.role}\` agent still has to run`
        + (f.cadence === 'feature' ? ' before the feature can be called done.' : ' for this task.'),
      fix_review: (f) => `The \`${f.role}\` agent left ${f.findings} finding(s) at ${at(f.reviewDate)} in .chalc/review.md.`,
      tick_task: (f) => `Gate green and review clean: tick "${f.task}" in tasks.md (${f.done + 1}/${f.total}).`
        + (f.waitForApproval ? ' Then STOP and wait for my OK before moving on.' : ''),
      work_task: (f) => `Next up: "${f.task}" (${f.done}/${f.total} done). Strict TDD: failing test, minimum code, refactor.`,
      done: (f) => `All ${f.total} tasks are ticked. The feature is complete.`,
      ask_human: (f) => `I cannot tell where this stands: ${list(f.problems)}. Tell me instead of me guessing.`
    }
  }
};

// El motivo de una acción, en el idioma del spec. Un idioma desconocido cae al inglés: quedarse sin
// motivo sería peor que darlo en otro idioma.
export function reasonOf(action, facts = {}, lang = 'en') {
  const frame = FRAME[lang] || FRAME.en;
  const write = frame.reason[action] || FRAME.en.reason[action];
  return write ? write(facts) : '';
}
