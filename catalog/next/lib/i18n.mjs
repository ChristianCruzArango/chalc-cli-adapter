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
import { messageOf } from '../../gate/lib/i18n.mjs';

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

// Un hallazgo de seguridad se corrige empezando por un test que reproduzca el ataque (spec 014, R22):
// sin él, la corrección no se puede comprobar y la vulnerabilidad vuelve con el siguiente cambio.
const isSecurity = (f) => (f.failed || []).includes('security') || f.role === 'seguridad';
const SECURITY_FIX = {
  es: ' Es de seguridad: primero escribe un test que demuestre la vulnerabilidad, y solo después corrige.',
  en: ' It is a security finding: first write a test that demonstrates the vulnerability, and only then fix it.'
};

// La memoria de la tarea, en una sola línea dentro del motivo (spec 015, R15, R16): el contrato de
// tres líneas del advisor no cambia. Como mucho las pocas entradas que eligió `recall`, cada una con
// su id para pedir el detalle.
const KIND = { es: { bug: 'bug', rule: 'regla', decision: 'decisión' }, en: { bug: 'bug', rule: 'rule', decision: 'decision' } };
const STALE = { es: ' (posible-vieja)', en: ' (possibly stale)' };

// Un título largo se corta en el último espacio antes del límite, con «…»: cortar una palabra a la
// mitad cambia lo que dice.
const shorten = (text, max = 90) => {
  const plain = String(text);
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 0 ? cut.lastIndexOf(' ') : max).replace(/[\s,.;:]+$/, '')}…`;
};

const item = (e, lang) => `${e.id} (${KIND[lang][e.kind] || e.kind}) ${shorten(e.title)}`
  + `${e.files?.length ? ` [${e.files.slice(0, 2).join(', ')}]` : ''}${e.stale ? STALE[lang] : ''}`;
const listOf = (entries, lang) => entries.map((e) => item(e, lang)).join('; ');

const MEMORY_NOTE = {
  es: {
    work: (m) => ` Memoria de esta tarea (no repitas lo que ya pasó): ${listOf(m, 'es')}. Detalle: node .chalc/memory.mjs get <id>.`,
    role: (rules, decisions) => (rules.length ? ` Verifica estas reglas aprendidas y deja una línea por cada una: ${listOf(rules, 'es')}.` : '')
      + (decisions.length ? ` Decisiones aceptadas (no las reportes): ${listOf(decisions, 'es')}.` : '')
      + ' Detalle: node .chalc/memory.mjs get <id>.'
  },
  en: {
    work: (m) => ` Memory for this task (do not repeat what already happened): ${listOf(m, 'en')}. Detail: node .chalc/memory.mjs get <id>.`,
    role: (rules, decisions) => (rules.length ? ` Verify these learned rules and leave one line for each: ${listOf(rules, 'en')}.` : '')
      + (decisions.length ? ` Accepted decisions (do not report them): ${listOf(decisions, 'en')}.` : '')
      + ' Detail: node .chalc/memory.mjs get <id>.'
  }
};

const workMemory = (f, lang) => (f.memory?.length ? MEMORY_NOTE[lang].work(f.memory) : '');
const roleMemory = (f, lang) => {
  if (!f.memory?.length) return '';
  const decisions = f.memory.filter((e) => e.kind === 'decision');
  return MEMORY_NOTE[lang].role(f.memory.filter((e) => e.kind !== 'decision'), decisions);
};

// Los hallazgos de la pasada anterior del rol (spec 017, R9): con número y texto, y la forma exacta de
// responder a cada uno, que es la que el advisor exige después (R10). El formato de la respuesta no se
// traduce más allá de sus palabras: lo lee un script.
const PRIOR_NOTE = {
  es: (items) => ` Hallazgos de su pasada anterior; responde a cada uno con una línea «- Hallazgo <n>: corregido | no corregido | no aplica — archivo:línea o motivo»: ${items}.`,
  en: (items) => ` Findings from its previous pass; answer each with a line "- Finding <n>: fixed | not fixed | n/a — file:line or reason": ${items}.`
};
const priorNote = (f, lang) => (f.prior?.length ? PRIOR_NOTE[lang](f.prior.map((p) => `${p.n}. ${shorten(p.text, 200)}`).join('; ')) : '');

// Los requisitos que el rol tiene que responder uno por uno (spec 019, R4), con la forma exacta de la
// línea, que es la que el advisor exige después.
const REQUIREMENTS_NOTE = {
  es: (ids) => ` Revisa requisito por requisito (${ids}): una línea «- R<n>: cumple | no cumple | no aplica — archivo:línea o motivo» por cada uno.`,
  en: (ids) => ` Review requirement by requirement (${ids}): one line "- R<n>: complies | violates | n/a — file:line or reason" for each.`
};
const requirementsNote = (f, lang) => (f.requirements?.length ? REQUIREMENTS_NOTE[lang](f.requirements.join(', ')) : '');

// Los problemas de coherencia (spec 024, R9), cada uno con su archivo y línea y la frase del portón, que es
// quien los define. Acotados: una lista interminable no se lee; el resto sale al corregir los primeros.
const MAX_PROBLEMS = 12;
const MORE = { es: (n) => ` (+${n} más)`, en: (n) => ` (+${n} more)` };
const problemList = (problems, lang) => problems.slice(0, MAX_PROBLEMS)
  .map((p) => `${p.file}:${p.line} — ${messageOf(p.rule, p.data, lang)}`).join('; ')
  + (problems.length > MAX_PROBLEMS ? MORE[lang](problems.length - MAX_PROBLEMS) : '');

const SPEC_NOTE = {
  es: {
    none: 'No hay ninguna carpeta de spec. Crea `specs/NNN-nombre/` con su `hu.md` (la HU tal cual la entregó el usuario, con su línea «Fuente:») antes de nada: sin HU no hay contra qué comprobar la spec. No escribas tests ni código.',
    fix: (f) => `La spec${f.dir ? ` de \`${f.dir}\`` : ''} no es coherente todavía (${f.problems.length} problema(s)). No escribas tests ni código: corrige esto primero`
      + `${f.author ? `, encargándolo al agente \`${f.author}\`` : ''}. ${problemList(f.problems, 'es')}`,
    role: (f) => `La spec de \`${f.dir}\` ya no tiene problemas mecánicos y falta que la revise el agente \`${f.role}\` contra la HU. `
      + `Su entrada en .chalc/review.md debe llevar la línea «- Huella: ${f.fingerprint}». No escribas tests ni código todavía.`
  },
  en: {
    none: 'There is no spec folder. Create `specs/NNN-name/` with its `hu.md` (the user story exactly as the user delivered it, with its "Source:" line) before anything else: without the story there is nothing to check the spec against. Write no tests or code.',
    fix: (f) => `The spec${f.dir ? ` in \`${f.dir}\`` : ''} is not coherent yet (${f.problems.length} problem(s)). Write no tests or code: fix this first`
      + `${f.author ? `, handing it to the \`${f.author}\` agent` : ''}. ${problemList(f.problems, 'en')}`,
    role: (f) => `The spec in \`${f.dir}\` has no mechanical problems left and the \`${f.role}\` agent still has to review it against the user story. `
      + `Its entry in .chalc/review.md must carry the line "- Fingerprint: ${f.fingerprint}". Write no tests or code yet.`
  }
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
      fix_gate: (f) => `La evidencia de las ${at(f.evidenceDate)} salió con veredicto \`${f.verdict}\`. Arregla lo que reporta .chalc/gate.md.`
        + (isSecurity(f) ? SECURITY_FIX.es : ''),
      fix_specs: (f) => (f.noSpec ? SPEC_NOTE.es.none : SPEC_NOTE.es.fix(f)),
      approve_spec: (f) => `La spec de \`${f.dir}\` es coherente y está validada (huella ${f.fingerprint}). PARA aquí: solo el usuario la aprueba, `
        + `en SU terminal, con el COMMAND. Espera su OK explícito; no escribas tests ni código antes y no ejecutes tú el comando.`,
      call_role: (f) => (f.cadence === 'spec' ? SPEC_NOTE.es.role(f) : `El portón aprobó a las ${at(f.evidenceDate)} y falta que pase el agente \`${f.role}\``
        + (f.cadence === 'feature' ? ' antes de dar la feature por terminada.' : ' por esta tarea.') + roleMemory(f, 'es') + requirementsNote(f, 'es')) + priorNote(f, 'es'),
      fix_review: (f) => `El agente \`${f.role}\` dejó ${f.findings} hallazgo(s) a las ${at(f.reviewDate)} en .chalc/review.md.`
        + (isSecurity(f) ? SECURITY_FIX.es : '') + requirementsNote(f, 'es') + priorNote(f, 'es'),
      tick_task: (f) => `Portón verde y revisión limpia: primero corre el COMMAND (guarda en la memoria lo que enseñó la tarea) y después marca «${f.task}» en tasks.md (${f.done + 1}/${f.total}).`,
      red_task: (f) => `Toca «${f.task}» (${f.done}/${f.total} hechas). Primero SOLO los tests de sus criterios${f.requirements?.length ? ` (${f.requirements.join(', ')}; cítalos en los tests)` : ''}: `
        + `escríbelos, compruébalos en rojo y regístralos con el COMMAND. Nada de código de producción todavía: el portón lo rechaza sin el rojo. `
        + `Si la tarea de verdad no lleva tests, añade --skip "<motivo>".` + workMemory(f, 'es'),
      work_task: (f) => `Toca «${f.task}» (${f.done}/${f.total} hechas). TDD estricto: test que falla, código mínimo, refactor.` + workMemory(f, 'es'),
      deliver_spec: (f) => `Las ${f.total} tareas de \`${f.dir}\` están hechas y el portón aprobó. Commitea todo y entrega con el COMMAND: no llames tú a quien revisa ni pidas el cierre; eso lo hace quien te despachó.`,
      approve_feature: (f) => `Las ${f.total} tareas de \`${f.dir}\` están hechas, medidas y revisadas. PARA aquí: el cierre lo aprueba solo el usuario, `
        + `en SU terminal, con el COMMAND. Entrégale el resumen de lo hecho y espera su OK explícito; no ejecutes tú el comando.`,
      done: (f) => `Las ${f.total} tareas están marcadas. La feature terminó: corre el COMMAND para guardar en la memoria lo que enseñó el cierre.`,
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
      fix_gate: (f) => `The evidence from ${at(f.evidenceDate)} came out \`${f.verdict}\`. Fix what .chalc/gate.md reports.`
        + (isSecurity(f) ? SECURITY_FIX.en : ''),
      fix_specs: (f) => (f.noSpec ? SPEC_NOTE.en.none : SPEC_NOTE.en.fix(f)),
      approve_spec: (f) => `The spec in \`${f.dir}\` is coherent and validated (fingerprint ${f.fingerprint}). STOP here: only the user approves it, `
        + `in THEIR terminal, with the COMMAND. Wait for their explicit OK; write no tests or code before that and do not run the command yourself.`,
      call_role: (f) => (f.cadence === 'spec' ? SPEC_NOTE.en.role(f) : `The gate passed at ${at(f.evidenceDate)} and the \`${f.role}\` agent still has to run`
        + (f.cadence === 'feature' ? ' before the feature can be called done.' : ' for this task.') + roleMemory(f, 'en') + requirementsNote(f, 'en')) + priorNote(f, 'en'),
      fix_review: (f) => `The \`${f.role}\` agent left ${f.findings} finding(s) at ${at(f.reviewDate)} in .chalc/review.md.`
        + (isSecurity(f) ? SECURITY_FIX.en : '') + requirementsNote(f, 'en') + priorNote(f, 'en'),
      tick_task: (f) => `Gate green and review clean: first run the COMMAND (it stores what the task taught in the memory), then tick "${f.task}" in tasks.md (${f.done + 1}/${f.total}).`,
      red_task: (f) => `Next up: "${f.task}" (${f.done}/${f.total} done). First ONLY the tests for its criteria${f.requirements?.length ? ` (${f.requirements.join(', ')}; cite them in the tests)` : ''}: `
        + `write them, see them fail and register them with the COMMAND. No production code yet: the gate rejects it without the red. `
        + `If the task truly carries no tests, add --skip "<reason>".` + workMemory(f, 'en'),
      work_task: (f) => `Next up: "${f.task}" (${f.done}/${f.total} done). Strict TDD: failing test, minimum code, refactor.` + workMemory(f, 'en'),
      deliver_spec: (f) => `The ${f.total} tasks of \`${f.dir}\` are done and the gate passed. Commit everything and deliver with the COMMAND: do not call the reviewers yourself or ask for the close; whoever dispatched you does that.`,
      approve_feature: (f) => `The ${f.total} tasks of \`${f.dir}\` are done, measured and reviewed. STOP here: the close is approved only by the user, `
        + `in THEIR terminal, with the COMMAND. Hand them the summary of what was done and wait for their explicit OK; do not run the command yourself.`,
      done: (f) => `All ${f.total} tasks are ticked. The feature is complete: run the COMMAND to store in the memory what the closing taught.`,
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
