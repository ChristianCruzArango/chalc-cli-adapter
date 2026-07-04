// cli/engine/loop.mjs — motor del harness: loop plan→acción→observación para modelos locales.
// El modelo propone UNA acción por turno (JSON compacto); el loop la ejecuta con una herramienta
// determinista y le devuelve la observación. Diseñado para modelos limitados: CCR comprime las
// observaciones voluminosas y el modelo conoce su presupuesto de pasos para converger.
//
// Responsabilidad ÚNICA: orquestar el ciclo. NO sabe de proveedores (se inyecta `chatImpl`), ni del
// texto del harness (se inyecta `renderPrompt`), ni de la interfaz (emite eventos por `onStep`).
// Esa inversión de dependencias hace el motor testeable sin tokens y reutilizable por cualquier shell.

import { createCcrStore, compactObject } from '../../lib/ccr.mjs';
import { readTurn, retryMessage } from './protocol.mjs';

// Ejecuta una herramienta de forma segura: un fallo del executor se vuelve observación, no una excepción
// que tumbe el loop. El modelo ve el error y puede recuperarse en el siguiente turno.
async function runTool(tool, args) {
  try {
    return await tool.run(args || {});
  } catch (e) {
    return { error: String(e?.message || e) };
  }
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
  const finish = (extra) => ({ steps: history, ccr: store?.stats() || null, ...extra });
  const push = (record) => { history.push(record); if (onStep) onStep(record); };
  const interrupted = () => finish({ done: false, interrupted: true, error: 'interrumpido por el usuario' });

  for (let step = 1; step <= maxSteps; step++) {
    if (shouldStop?.()) return interrupted();
    const stepsLeft = maxSteps - step;

    // Reintento DENTRO del mismo paso (no gasta presupuesto). Cubre dos fallos típicos de modelos locales:
    //  - respuesta malformada → se reintenta devolviendo el error concreto para que corrija (retryMessage).
    //  - error al llamar al modelo (red / servidor ocupado) → se reintenta sin nota (no hubo respuesta que corregir).
    let turn = null;
    let lastError = '';
    let retryNote = '';
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const { system, user } = renderPrompt({ history, step, stepsLeft, retry: retryNote });
      let raw;
      try {
        raw = await chatImpl({ system, user });
      } catch (e) {
        lastError = `error al llamar al modelo: ${e?.message || e}`;
        retryNote = '';
        // Reintento VISIBLE: sin este aviso, 3 timeouts consecutivos de 5 min dejan la UI muda un cuarto
        // de hora y parece un cuelgue. Evento solo para la UI (NO entra a history: el modelo no lo ve).
        onStep?.({ action: { tool: 'modelo' }, observation: { error: `${lastError} — reintento ${attempt + 1}/${maxRetries + 1}` } });
        continue;
      }
      const parsed = readTurn(raw);
      if (parsed.ok) { turn = parsed.turn; break; }
      lastError = parsed.error;
      retryNote = retryMessage(parsed.error);
    }
    if (!turn) return finish({ done: false, error: `Sin turno válido tras ${maxRetries + 1} intentos: ${lastError}` });

    if (turn.kind === 'done') return finish({ done: true, summary: turn.summary });

    // El usuario canceló MIENTRAS el modelo generaba: no se ejecuta la acción que acaba de proponer.
    if (shouldStop?.()) return interrupted();

    // Cortacircuito anti-bucle: si esta acción es IDÉNTICA a las 2 últimas y ambas fallaron, el modelo
    // está atascado (p. ej. repite un nombre de tool truncado ignorando la corrección). Abortar el turno
    // ahorra el resto del presupuesto de pasos y le da al usuario un error claro en vez de 8 repeticiones.
    const sameFailing = (r) => r.observation?.error && r.action?.tool === turn.tool
      && JSON.stringify(r.action?.args || {}) === JSON.stringify(turn.args || {});
    if (history.length >= 2 && history.slice(-2).every(sameFailing)) {
      return finish({ done: false, error: `bucle detectado: el modelo repitió 3 veces la misma acción fallida (${turn.tool}: ${history[history.length - 1].observation.error}). Reformula la instrucción.` });
    }

    // recall: meta-herramienta del propio loop. Expande una referencia CCR desde la caché, sin ejecutar
    // nada externo. Se guarda SIN comprimir: es una expansión deliberada que el modelo pidió ver.
    if (turn.tool === 'recall') {
      const ref = turn.args?.ref;
      const content = store ? store.recall(ref) : null;
      push({
        step, thought: turn.thought, action: { tool: 'recall', args: turn.args },
        observation: content != null ? { recall: ref, content } : { recall: ref, error: 'CCR reference expired or unknown' }
      });
      continue;
    }

    // Los modelos locales truncan/mal escriben nombres largos (mcp__server__tool). Si el nombre no existe
    // pero es prefijo inequívoco de UNA tool (o viceversa), se auto-resuelve; si hay varias, se devuelven
    // los nombres válidos para que el modelo se corrija. Solo PREFIJOS y con mínimo 4 caracteres: con
    // contención ("includes") un nombre corto inventado ("sh", "it") se resolvería a una tool DISTINTA
    // (bash, edit) y el agente ejecutaría algo que el modelo no pidió.
    let toolName = turn.tool;
    let tool = tools[toolName];
    if (!tool) {
      const names = Object.keys(tools);
      let near = turn.tool.length >= 4
        ? names.filter((n) => n.startsWith(turn.tool) || turn.tool.startsWith(n))
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
      if (near.length === 1) { toolName = near[0]; tool = tools[toolName]; }
      else {
        // Con candidatos, dar un ejemplo COPIABLE: los modelos locales corrigen mucho mejor imitando
        // un nombre completo concreto que leyendo una lista. Sin candidatos, el modelo INVENTÓ la tool
        // (p. ej. mcp__angular-cli__generate) — redirigir SOLO a alternativas que EXISTEN aquí: en los
        // roles de solo lectura (planner/reviewer) no hay write/edit/bash, y pedir write en ellos
        // significa que el modelo intenta EJECUTAR cuando su entregable es el done.summary.
        const basics = ['write', 'edit', 'bash'].filter((n) => n in tools);
        const wantsMutation = ['write', 'edit', 'bash'].includes(turn.tool);
        const hint = near.length
          ? `. The name is incomplete: use the FULL exact name, e.g. "${near[0]}"`
          : (wantsMutation && !basics.length
            ? '. You are in a READ-ONLY role: do NOT execute changes; explore with read/list/grep and deliver your result with {"done":true,"summary":"..."}'
            : `. That tool does NOT exist: pick EXACTLY one from "available"${basics.length ? `, or do it with ${basics.join('/')}` : ''}`);
        // 2ª repetición idéntica: escalar la corrección (a la 3ª actúa el cortacircuito). El error es
        // determinista — repetirlo igual JAMÁS va a funcionar, y decírselo explícito rompe el patrón.
        const repeatNote = history.length && sameFailing(history[history.length - 1])
          ? ' You ALREADY failed with this SAME name; do not repeat it: switch to another tool or copy a name from "available".'
          : '';
        const record = {
          step, thought: turn.thought, action: { tool: turn.tool, args: turn.args },
          observation: { error: `unknown tool: ${turn.tool}${hint}${repeatNote}`, available: (near.length ? near : names).slice(0, 12) }
        };
        push(record);
        continue;
      }
    }
    // Anti-bucle: los modelos locales repiten la MISMA acción cuando no entendieron su resultado (p. ej. una
    // referencia CCR). Repetirla re-ejecuta el tool y re-pide aprobación en círculo. Si la acción es idéntica
    // a una ya ejecutada con éxito, NO se re-ejecuta: se le recuerda dónde está el resultado y cómo expandirlo.
    const signature = toolName + ' ' + JSON.stringify(turn.args || {});
    const prior = history.find((r) => r.signature === signature && !r.observation?.error);
    if (prior) {
      push({
        step, thought: turn.thought, action: { tool: toolName, args: turn.args }, signature,
        observation: {
          repeated: true,
          note: `You already ran this exact action in step ${prior.step}; its result is there. Do not repeat it: if the result carries [CCR ref=X …] and you need the full content, use {"action":{"tool":"recall","args":{"ref":"X"}}}; otherwise continue with the NEXT action of the task.`
        }
      });
      // Tres "repeated" seguidos: el modelo quedó orbitando acciones ya ejecutadas y no va a converger solo.
      // Si el turno YA produjo una mutación exitosa, el trabajo está hecho → se cierra el paso (done) en vez
      // de quemar el presupuesto restante; si no mutó nada, error claro (el enforcement decidirá reintentar).
      if (history.length >= 3 && history.slice(-3).every((r) => r.observation?.repeated)) {
        const mutated = history.some((r) =>
          (['write', 'edit'].includes(r.action?.tool) && r.observation?.ok) ||
          (r.action?.tool === 'bash' && r.observation?.code === 0));
        if (mutated) return finish({ done: true, summary: '(auto) el cambio ya estaba aplicado en pasos previos; el modelo repetía una acción ya ejecutada.' });
        return finish({ done: false, error: 'bucle: el modelo repite acciones ya ejecutadas sin producir cambios.' });
      }
      continue;
    }

    const observation = await runTool(tool, turn.args);
    // Las observaciones de tools SÍ se comprimen: pueden ser archivos enteros o salidas de shell largas.
    push({
      step, thought: turn.thought, action: { tool: toolName, args: turn.args }, signature,
      observation: store ? compactObject(store, observation) : observation
    });
  }

  return finish({ done: false, error: `Se agotaron los ${maxSteps} pasos sin un turno "done".` });
}
