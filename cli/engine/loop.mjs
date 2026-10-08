// cli/engine/loop.mjs — motor del harness: loop plan→acción→observación para modelos locales.
// El modelo propone UNA acción por turno (JSON compacto); el loop la ejecuta con una herramienta
// determinista y le devuelve la observación. Diseñado para modelos limitados: CCR comprime las
// observaciones voluminosas y el modelo conoce su presupuesto de pasos para converger.
//
// Responsabilidad ÚNICA: orquestar el ciclo. NO sabe de proveedores (se inyecta `chatImpl`), ni del
// texto del harness (se inyecta `renderPrompt`), ni de la interfaz (emite eventos por `onStep`).
// Esa inversión de dependencias hace el motor testeable sin tokens y reutilizable por cualquier shell.

import { createCcrStore, compactObject } from '../../lib/ccr.mjs';
import { redactStrings } from '../../lib/redact.mjs';
import { t } from '../../lib/i18n.mjs';
import { readTurn, retryMessage } from './protocol.mjs';

// Ejecuta una herramienta de forma segura: un fallo del executor se vuelve observación, no una excepción
// que tumbe el loop. El modelo ve el error y puede recuperarse en el siguiente turno.
// Toda observación pasa por la redacción ESTRICTA antes de llegar al modelo (o a un proveedor en la
// nube): un JWT, una API key o una clave PEM que aparezca en un archivo o en la salida de un comando
// no sale de la máquina. Las herramientas aplican además la completa a los archivos de secretos.
// ¿Terminó bien? Sin `error` y, si es un comando, con código 0.
const succeeded = (obs) => !!obs && !obs.error && (obs.code === undefined || obs.code === 0);

// Lo que cambia el estado del proyecto: escribir/editar, ejecutar un comando o llamar a una tool MCP.
const MUTATES = (tool) => ['write', 'edit', 'bash'].includes(tool) || String(tool).startsWith('mcp__');
const lastMutationIndex = (history) => {
  for (let i = history.length - 1; i >= 0; i--) {
    const r = history[i];
    if (MUTATES(r.action?.tool) && !r.observation?.repeated) return i;
  }
  return -1;
};

async function runTool(tool, args) {
  try {
    return redactStrings(await tool.run(args || {}));
  } catch (e) {
    return { error: redactStrings(String(e?.message || e)) };
  }
}

// ¿Es `r` un intento fallido de la MISMA acción que `turn`?
const sameFailing = (r, turn) => r.observation?.error && r.action?.tool === turn.tool
  && JSON.stringify(r.action?.args || {}) === JSON.stringify(turn.args || {});

// Reintento DENTRO del mismo paso (no gasta presupuesto). Cubre dos fallos típicos de modelos locales:
//  - respuesta malformada → se reintenta devolviendo el error concreto para que corrija (retryMessage).
//  - error al llamar al modelo (red / servidor ocupado) → se reintenta sin nota (no hubo respuesta que corregir).
// Devuelve { turn } o { error }.
async function readValidTurn(a, step, stepsLeft) {
  let lastError = '';
  let retryNote = '';
  for (let attempt = 0; attempt <= a.maxRetries; attempt++) {
    const { system, user } = a.renderPrompt({ history: a.history, step, stepsLeft, retry: retryNote });
    let raw;
    try {
      raw = await a.chatImpl({ system, user });
    } catch (e) {
      lastError = t('cliLoopModelError', e?.message || e);
      retryNote = '';
      // Reintento VISIBLE: sin este aviso, 3 timeouts consecutivos de 5 min dejan la UI muda un cuarto
      // de hora y parece un cuelgue. Evento solo para la UI (NO entra a history: el modelo no lo ve).
      a.onStep?.({ action: { tool: 'modelo' }, observation: { error: t('cliLoopRetry', lastError, attempt + 1, a.maxRetries + 1) } });
      continue;
    }
    const parsed = readTurn(raw);
    if (parsed.ok) return { turn: parsed.turn };
    lastError = parsed.error;
    retryNote = retryMessage(parsed.error);
  }
  return { error: t('cliLoopNoValidTurn', a.maxRetries + 1, lastError) };
}

// recall: meta-herramienta del propio loop. Expande una referencia CCR desde la caché, sin ejecutar
// nada externo. Se guarda SIN comprimir: es una expansión deliberada que el modelo pidió ver.
function recallRecord(store, step, turn) {
  const ref = turn.args?.ref;
  const content = store ? store.recall(ref) : null;
  return {
    step, thought: turn.thought, action: { tool: 'recall', args: turn.args },
    observation: content != null ? { recall: ref, content } : { recall: ref, error: 'CCR reference expired or unknown' }
  };
}

// Los modelos locales truncan/mal escriben nombres largos (mcp__server__tool). Si el nombre no existe
// pero es prefijo inequívoco de UNA tool (o viceversa), se auto-resuelve; si hay varias, se devuelven
// los nombres válidos para que el modelo se corrija. Solo PREFIJOS y con mínimo 4 caracteres: con
// contención ("includes") un nombre corto inventado ("sh", "it") se resolvería a una tool DISTINTA
// (bash, edit) y el agente ejecutaría algo que el modelo no pidió. Devuelve los candidatos.
function nearTools(tools, turn) {
  const names = Object.keys(tools);
  // Solo nombres TRUNCADOS de tools MCP (el modelo escribió el principio de un nombre largo). La otra
  // dirección —un nombre más largo que empieza por el de una tool— convertía `editor_x` en `edit` y
  // `bash_y` en `bash`: el agente ejecutaba una tool local que el modelo no pidió.
  let near = turn.tool.length >= 4
    ? names.filter((n) => n.startsWith('mcp__') && n.startsWith(turn.tool))
    : [];
  // Sufijo único: el modelo escribió solo el nombre de la tool sin el prefijo del server
  // ("get_best_practices" → "mcp__angular-cli__get_best_practices").
  if (near.length !== 1 && turn.tool.length >= 4) {
    const bySuffix = names.filter((n) => n.endsWith(`__${turn.tool}`));
    if (bySuffix.length === 1) near = bySuffix;
  }
  // Namespace inventado con punto/slash (gpt-oss alucina tools de su entrenamiento:
  // "repo_browser.list", "functions.write"): si el ÚLTIMO segmento coincide EXACTO con una tool
  // disponible, la intención es inequívoca — se resuelve en vez de rebotar hasta el cortacircuito.
  if (near.length !== 1 && /[./]/.test(turn.tool)) {
    const tail = turn.tool.split(/[./]/).pop();
    if (names.includes(tail)) near = [tail];
  }
  // Varios candidatos (típico: escribió solo "mcp__<server>"): desambiguar por los ARGS enviados —
  // si sus claves solo encajan en el esquema (argHints) de UNA candidata, es esa.
  if (near.length > 1) {
    const keys = Object.keys(turn.args || {});
    if (keys.length) {
      const byArgs = near.filter((n) => Array.isArray(tools[n]?.argHints) && keys.every((k) => tools[n].argHints.includes(k)));
      if (byArgs.length === 1) near = byArgs;
    }
  }
  return near;
}

// La observación de una tool que no existe. Con candidatos, un ejemplo COPIABLE: los modelos locales
// corrigen mucho mejor imitando un nombre completo concreto que leyendo una lista. Sin candidatos, el
// modelo INVENTÓ la tool (p. ej. mcp__angular-cli__generate) — se redirige SOLO a alternativas que
// EXISTEN aquí: en los roles de solo lectura (planner/reviewer) no hay write/edit/bash, y pedir write
// en ellos significa que el modelo intenta EJECUTAR cuando su entregable es el done.summary.
function unknownToolRecord(tools, turn, near, history, step) {
  const names = Object.keys(tools);
  const basics = ['write', 'edit', 'bash'].filter((n) => n in tools);
  const wantsMutation = ['write', 'edit', 'bash'].includes(turn.tool);
  const hint = near.length
    ? `. The name is incomplete: use the FULL exact name, e.g. "${near[0]}"`
    : (wantsMutation && !basics.length
      ? '. You are in a READ-ONLY role: do NOT execute changes; explore with read/list/grep and deliver your result with {"done":true,"summary":"..."}'
      : `. That tool does NOT exist: pick EXACTLY one from "available"${basics.length ? `, or do it with ${basics.join('/')}` : ''}`);
  // 2ª repetición idéntica: escalar la corrección (a la 3ª actúa el cortacircuito). El error es
  // determinista — repetirlo igual JAMÁS va a funcionar, y decírselo explícito rompe el patrón.
  const repeatNote = history.length && sameFailing(history[history.length - 1], turn)
    ? ' You ALREADY failed with this SAME name; do not repeat it: switch to another tool or copy a name from "available".'
    : '';
  return {
    step, thought: turn.thought, action: { tool: turn.tool, args: turn.args },
    observation: { error: `unknown tool: ${turn.tool}${hint}${repeatNote}`, available: (near.length ? near : names).slice(0, 12) }
  };
}

// Anti-bucle: los modelos locales repiten la MISMA acción cuando no entendieron su resultado (p. ej. una
// referencia CCR). Repetirla re-ejecuta el tool y re-pide aprobación en círculo. Si la acción es idéntica
// a una ya ejecutada con éxito, NO se re-ejecuta: se le recuerda dónde está el resultado y cómo expandirlo.
//
// Dos matices que la auditoría encontró (F-10): un comando que salió con código ≠ 0 FALLÓ aunque no
// traiga `error` (`npm test` en rojo), y una MUTACIÓN posterior (write/edit, un comando, una tool
// MCP) cambia el mundo — repetir `npm test` tras corregir o releer un archivo tras editarlo es
// legítimo. Solo cuentan como repetición las acciones exitosas desde la última mutación. Repetir la
// MISMA mutación (la misma escritura) sigue siendo un bucle: esa no reinicia nada.
function priorSuccess(history, signature) {
  const lm = lastMutationIndex(history);
  const sinceChange = history.slice(lm >= 0 && history[lm].signature === signature ? lm : lm + 1);
  return sinceChange.find((r) => r.signature === signature && succeeded(r.observation));
}

function repeatedRecord(step, turn, toolName, signature, prior) {
  return {
    step, thought: turn.thought, action: { tool: toolName, args: turn.args }, signature,
    observation: {
      repeated: true,
      note: `You already ran this exact action in step ${prior.step}; its result is there. Do not repeat it: if the result carries [CCR ref=X …] and you need the full content, use {"action":{"tool":"recall","args":{"ref":"X"}}}; otherwise continue with the NEXT action of the task.`
    }
  };
}

// Tres "repeated" seguidos: el modelo quedó orbitando acciones ya ejecutadas y no va a converger solo.
// Si el turno YA produjo una mutación exitosa, el trabajo está hecho → se cierra el paso (done) en vez
// de quemar el presupuesto restante; si no mutó nada, error claro (el enforcement decidirá reintentar).
// Devuelve el cierre, o null si aún no toca.
function orbitingOutcome(history) {
  if (history.length < 3 || !history.slice(-3).every((r) => r.observation?.repeated)) return null;
  const mutated = history.some((r) =>
    (['write', 'edit'].includes(r.action?.tool) && r.observation?.ok) ||
    (r.action?.tool === 'bash' && r.observation?.code === 0));
  return mutated ? { done: true, summary: t('cliLoopAutoDone') } : { done: false, error: t('cliLoopRepeatsNoChange') };
}

// Ejecuta UNA acción ya validada: recall, tool desconocida, repetición o tool real. Devuelve un cierre
// del turno (`{ done, … }`) o null para seguir con el siguiente paso.
async function act(a, step, turn) {
  if (turn.tool === 'recall') { a.push(recallRecord(a.store, step, turn)); return null; }
  let toolName = turn.tool;
  if (!a.tools[toolName]) {
    const near = nearTools(a.tools, turn);
    if (near.length !== 1) { a.push(unknownToolRecord(a.tools, turn, near, a.history, step)); return null; }
    toolName = near[0];
  }
  const signature = toolName + '\u0000' + JSON.stringify(turn.args || {});
  const prior = priorSuccess(a.history, signature);
  if (prior) {
    a.push(repeatedRecord(step, turn, toolName, signature, prior));
    return orbitingOutcome(a.history);
  }
  const observation = await runTool(a.tools[toolName], turn.args);
  // Las observaciones de tools SÍ se comprimen: pueden ser archivos enteros o salidas de shell largas.
  a.push({
    step, thought: turn.thought, action: { tool: toolName, args: turn.args }, signature,
    observation: a.store ? compactObject(a.store, observation) : observation
  });
  return null;
}

// tools: { [name]: { summary, run(args) } }  — `run` devuelve la observación (objeto o string).
// renderPrompt({ history, step, stepsLeft, retry }) -> { system, user }  — arma el prompt del turno.
// chatImpl({ system, user }) -> texto crudo del modelo.
// ccr: store de createCcrStore() (por defecto), o false para desactivar la compresión.
// shouldStop(): interrupción cooperativa del usuario (ESC/Ctrl+C) — se consulta al inicio de cada paso y
// tras la respuesta del modelo (para no EJECUTAR una acción pedida mientras el usuario ya canceló).
// Devuelve { steps, done, summary?, error?, interrupted?, ccr }.
export async function runAgent({ chatImpl, tools = {}, renderPrompt, ccr, maxSteps = 12, maxRetries = 2, onStep, shouldStop } = {}) {
  if (typeof chatImpl !== 'function') throw new Error('runAgent requiere chatImpl.');
  if (typeof renderPrompt !== 'function') throw new Error('runAgent requiere renderPrompt.');
  const store = ccr === false ? null : (ccr && typeof ccr.compact === 'function' ? ccr : createCcrStore());
  const history = [];
  const a = { chatImpl, tools, renderPrompt, store, history, maxRetries, onStep, push: (record) => { history.push(record); if (onStep) onStep(record); } };
  const finish = (extra) => ({ steps: history, ccr: store?.stats() || null, ...extra });
  const interrupted = () => finish({ done: false, interrupted: true, error: t('cliLoopInterrupted') });

  for (let step = 1; step <= maxSteps; step++) {
    if (shouldStop?.()) return interrupted();
    const { turn, error } = await readValidTurn(a, step, maxSteps - step);
    if (!turn) return finish({ done: false, error });
    if (turn.kind === 'done') return finish({ done: true, summary: turn.summary });
    // El usuario canceló MIENTRAS el modelo generaba: no se ejecuta la acción que acaba de proponer.
    if (shouldStop?.()) return interrupted();
    // Cortacircuito anti-bucle: si esta acción es IDÉNTICA a las 2 últimas y ambas fallaron, el modelo
    // está atascado (p. ej. repite un nombre de tool truncado ignorando la corrección). Abortar el turno
    // ahorra el resto del presupuesto de pasos y le da al usuario un error claro en vez de 8 repeticiones.
    if (history.length >= 2 && history.slice(-2).every((r) => sameFailing(r, turn))) {
      return finish({ done: false, error: t('cliLoopDetected', turn.tool, history[history.length - 1].observation.error) });
    }
    const closed = await act(a, step, turn);
    if (closed) return finish(closed);
  }
  return finish({ done: false, error: t('cliLoopStepsExhausted', maxSteps) });
}
