// cli/shell/turns.mjs — los turnos de la shell, comunes a los dos front-ends: un turno del rol que
// ejecuta, el turno del líder (/plan) y la ejecución de un plan aprobado paso a paso.
// Todos reciben `shell` (el estado de la sesión de la shell, ver index.mjs) e `io` (la E/S del front-end).

import { t } from '../../lib/i18n.mjs';
import { tokenSummary, lastUsage, resetTokens } from '../../lib/tokenmeter.mjs';
import { flushTokenLog } from '../../lib/tokenlog.mjs';
import { touchedPaths } from '../engine/review.mjs';
import { planItems, stepTask, stepNeedsMutation, stepRetryTask, stepIsSpecWork } from '../engine/plan.mjs';
import { markStepDone, specInfo, PLAN_REL } from '../engine/planfile.mjs';
import { c, stepLine, resultLine, mutationReport, truncate } from '../ui/render.mjs';
import { requiresExplicitApproval } from '../tools/trust.mjs';

export const fmtK = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n));

// El modelo que se muestra para un rol: el suyo si está configurado, o el de la sesión.
export const modelOf = (shell, role) => shell.session.modelFor?.(role) || shell.model;

// io.setTurn (opcional) recibe { interrupt } al empezar y null al terminar: el front-end lo conecta a
// ESC (TUI) o Ctrl+C (scroll) para cancelar el turno sin matar la sesión. Devuelve `shouldStop`.
// Devuelve `shouldStop()` con su `signal`: el AbortSignal del turno (O-02). ESC/Ctrl+C lo aborta y
// corta EN CURSO la llamada al modelo, la shell y MCP, no solo entre pasos.
export function interruptible(io, message) {
  const controller = new AbortController();
  io.setTurn?.({
    interrupt: () => {
      if (controller.signal.aborted) return;
      controller.abort();
      io.print(c.yellow(message));
    }
  });
  const shouldStop = () => controller.signal.aborted;
  shouldStop.signal = controller.signal;
  return shouldStop;
}

// Suma un turno al consumo de la SESIÓN (para /tokens): el medidor se resetea por turno.
export function addTokens(shell, u) {
  shell.tokens.input += u.input; shell.tokens.output += u.output; shell.tokens.calls += u.calls;
}

// Consumo de un turno de rol (líder/revisor) VISIBLE en pantalla y sumado a /tokens: con roles en la
// nube (OpenRouter…) el usuario paga por token y debe ver cuánto gastó cada rol, no solo el coder.
export function reportRoleTokens(shell, io, label) {
  const u = tokenSummary();
  if (!u.calls) return;
  addTokens(shell, u);
  io.print(c.dim(t('cliRoleTokens', label, fmtK(u.input), fmtK(u.output), u.calls)));
}

function describeAction(action) {
  const a = action.args || {};
  const p = a.path || a.file || a.filename || a.file_path || t('cliNoPath');
  if (action.tool === 'write') return `write${a.append ? ' (append)' : ''} ${p} (${String(a.content ?? a.text ?? '').length} bytes)`;
  if (action.tool === 'edit') return `edit ${p}`;
  if (action.tool === 'bash') return `bash: ${a.command || a.cmd || ''}`;
  if (String(action.tool || '').startsWith('mcp__')) {
    const [, server, ...rest] = action.tool.split('__');
    return `MCP ${server}/${rest.join('__')} ${truncate(a, 80)}`;
  }
  return `${action.tool} ${truncate(a, 80)}`;
}

// La aprobación de un turno. "aprobar todo" arranca activado si /auto está encendido, y "a" lo activa
// para el resto del turno. /auto (y "a") NO cubre bash eval-capable (node/npx/python/npm run…): sin
// ese freno, auto-aprobación + perfil dev anula la única defensa real del shell (la aprobación humana).
function makeApprove(shell, io, role) {
  let approveAll = shell.approval.auto;
  const { session } = shell;
  return async (action) => {
    if (!shell.policy.needsApproval(action.tool)) return true;
    if (approveAll && !requiresExplicitApproval(action)) return true;
    const activeId = session.agents?.active(role);
    if (activeId) session.agents.update(activeId, { status: 'waiting_approval', currentAction: describeAction(action) });
    const ans = String(await io.confirm(describeAction(action))).trim().toLowerCase();
    if (activeId) session.agents.update(activeId, { status: 'running' });
    if (['a', 'all', 'todo'].includes(ans)) approveAll = true;
    const ok = ['y', 'yes', 's', 'si', 'a', 'all', 'todo'].includes(ans);
    // Feedback inmediato: sin esto, tras aprobar un comando lento (ng generate…) parece que "no hizo nada".
    io.print(ok ? c.dim(t('cliApproved')) : c.dim(t('cliDenied')));
    return ok;
  };
}

// Verificación DETERMINISTA contra las observaciones: el summary del modelo puede alucinar éxito
// ("Created…") sin haber hecho nada. Aquí se reporta lo que REALMENTE cambió, y se advierte si nada.
function reportTurn(shell, io, result) {
  io.print(resultLine(result));
  const rep = mutationReport(result.steps);
  if (rep.files.length) io.print(c.dim(t('cliReallyModified', [...new Set(rep.files)].join(', '))));
  if (result.done && !rep.mutated) io.print(c.yellow(t('cliNoMutationWarn')));
  const u = tokenSummary();
  addTokens(shell, u);
  // contexto = input de la ÚLTIMA llamada (ocupación real de la ventana); el acumulado sumaría pasos pasados.
  io.print(c.dim(t('cliTurnStats', fmtK(lastUsage().input), fmtK(io.numCtx), fmtK(u.output), result.steps.length)));
}

// Un turno, común a ambos front-ends. opts.plan: plan aprobado por el usuario (modo /plan) — viaja al
// harness como sección requerida. opts.role: el rol que decidió el orquestador — 'planner' (líder)
// para pasos de ESPECIFICACIÓN: el desarrollador jamás redacta los documentos que gobiernan su trabajo.
export async function runTurn(shell, io, task, opts = {}) {
  resetTokens();
  const role = opts.role === 'planner' ? 'planner' : 'coder';
  const shouldStop = interruptible(io, t('cliInterrupting'));
  const approve = makeApprove(shell, io, role);
  io.startThinking(role === 'planner' ? t('cliLeaderSpec', modelOf(shell, 'planner')) : t('cliDevWorking', modelOf(shell, 'coder')));
  try {
    const result = await shell.session.ask(task, { approve, onStep: (r) => io.print(stepLine(r)), shouldStop, plan: opts.plan, focus: opts.focus, role });
    io.stopThinking();
    reportTurn(shell, io, result);
    return result;
  } catch (e) {
    io.stopThinking();
    io.print(c.red(`✗ ${e.message}`));
    return null;
  } finally {
    io.setTurn?.(null);
    await flushTokenLog();   // persistir el gasto POR TURNO: una sesión larga no puede perderlo todo al caer
  }
}

// Sin plan no hay callejón sin salida: se ofrece ejecutar la tarea directo con el coder.
async function noPlan(io, r, interrupted) {
  io.print(c.yellow(t('cliNoPlanYet', r.error || t('cliPlannerNoPlan'))));
  if (r.narrative) io.print(c.dim(t('cliPlannerSaid', r.narrative.slice(0, 200) + (r.narrative.length > 200 ? '…' : ''))));
  if (interrupted) return null;
  const pick = await io.choose(c.yellow(t('cliRunDirectQ')), [t('cliOptYesDirect'), t('cliOptNoCancel')]);
  return pick === 0 ? { direct: true } : null;
}

// El plan propuesto, para que el usuario lo apruebe. El líder redacta el SPEC junto al plan: se
// anuncia aquí (se persiste solo si el plan se aprueba).
async function offerPlan(io, r) {
  io.print(c.bold(t('cliPlanProposed')));
  for (const line of r.plan.split('\n')) io.print('  ' + c.cyan('│ ') + line);
  io.print(r.spec ? c.dim(t('cliSpecWritten')) : c.yellow(t('cliSpecMissing')));
  const pick = await io.choose(c.yellow(t('cliRunPlanQ')), [t('cliOptYesRun'), t('cliOptNoDiscard')]);
  if (pick === 0) return { plan: r.plan, spec: r.spec || '' };
  io.print(c.dim(t('cliPlanDiscarded')));
  return null;
}

// Modo plan (F1): el planner explora en solo lectura y propone un plan numerado; se muestra al usuario
// y SOLO si lo aprueba se ejecuta con el plan inyectado. Devuelve { plan } (aprobado), { direct: true }
// (no hubo plan y el usuario eligió ejecutar la tarea directamente con el coder) o null (cancelado).
export async function runPlanTurn(shell, io, goal) {
  const shouldStop = interruptible(io, t('cliInterruptPlanner'));
  io.startThinking(t('cliLeaderPlanning', modelOf(shell, 'planner')));
  resetTokens();
  try {
    const r = await shell.session.plan(goal, { onStep: (s) => io.print(stepLine(s)), shouldStop });
    io.stopThinking();
    reportRoleTokens(shell, io, t('cliLeaderLabel', modelOf(shell, 'planner')));
    return r.plan ? await offerPlan(io, r) : await noPlan(io, r, shouldStop());
  } catch (e) {
    io.stopThinking();
    io.print(c.red(`✗ ${e.message}`));
    return null;
  } finally {
    io.setTurn?.(null);
    await flushTokenLog();   // el turno del líder también cuesta: persistir al terminar
  }
}

// Un paso del plan. Enrutamiento por ROL: los documentos de especificación los redacta el LÍDER (sin
// focus: especificar requiere el contexto íntegro). Enforcement anti-alucinación: si el paso implica
// CAMBIOS y el turno terminó "done" sin tocar nada (ni archivo ni comando), el done fue mentira — se
// re-ejecuta UNA vez con corrección dura.
async function runPlanStep(shell, io, { goal, items, i, spec, plan }) {
  const specStep = stepIsSpecWork(items[i]);
  if (specStep) io.print(c.dim(t('cliSpecStepByLeader')));
  const turnOpts = { plan, focus: !specStep, role: specStep ? 'planner' : 'coder' };
  let result = await runTurn(shell, io, stepTask(goal, items, i, spec), turnOpts);
  if (result?.done && stepNeedsMutation(items[i]) && !mutationReport(result.steps).mutated) {
    io.print(c.yellow(t('cliStepFalseDone')));
    result = await runTurn(shell, io, stepRetryTask(goal, items, i, spec), turnOpts);
    if (result?.done && !mutationReport(result.steps).mutated) result = { ...result, done: false, error: t('cliStepStillNoChanges') };
  }
  return result;
}

// Ejecuta un plan aprobado PASO A PASO: un turno por ítem, con el orquestador (este código) avanzando
// la lista — así ningún paso se salta ni se declara hecho sin ejecutarse. Si un paso falla, el usuario
// decide si continuar. Devuelve las rutas tocadas en total (para la revisión final).
// completed: pasos ya marcados [x] en .chalc/plan.md (modo retomar).
export async function executePlan(shell, io, { goal, plan, completed = [] }) {
  const items = planItems(plan);
  const projectPath = shell.session.project?.projectPath;
  // Spec del líder desde disco (el que ENLAZA plan.md — en specs/ del proyecto o .chalc): cada orden
  // viaja con SU sección — funciona igual en un plan recién aprobado y al RETOMAR.
  const { rel: specRel, text: spec } = specInfo(projectPath);
  if (spec) io.print(c.dim(t('cliSpecLoaded', specRel)));
  const touched = [];
  for (let i = 0; i < items.length; i++) {
    if (completed[i]) { io.print(c.dim(t('cliStepAlreadyDone', i + 1, items.length, PLAN_REL))); continue; }
    io.print(c.bold(t('cliStepHeader', i + 1, items.length)) + c.dim(' — ' + items[i].replace(/^\d{1,2}[.)]\s*/, '')));
    const result = await runPlanStep(shell, io, { goal, items, i, spec, plan });
    // Marcado DETERMINISTA del checklist: el harness marca [x] solo cuando el paso terminó done y
    // sobrevivió el enforcement de mutación — el modelo jamás marca su propia tarea.
    if (result?.done && projectPath) markStepDone(projectPath, i);
    if (result) touched.push(...touchedPaths(result));
    if (!result || result.interrupted) { io.print(c.dim(t('cliPlanStopped'))); break; }
    if (!result.done && await io.choose(c.yellow(t('cliStepFailedQ', i + 1)), [t('cliOptYesContinue'), t('cliOptNoStop')]) !== 0) {
      io.print(c.dim(t('cliPlanStopped'))); break;
    }
  }
  return [...new Set(touched)];
}
