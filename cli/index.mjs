#!/usr/bin/env node
// cli/index.mjs — shell interactiva del agente, estilo Claude Code. Dos front-ends con la MISMA lógica de turno:
//   - TUI (por defecto en terminal): título arriba, salida con scroll, caja de entrada FIJA abajo.
//   - inline (fallback si no es TTY o CHALC_TUI=0): banner + caja de contexto + spinner.
// Usa EXACTAMENTE el provider/model que el usuario configuró en config-ia. NO quema modelos.

import { createInterface } from 'node:readline/promises';
import { stdin, stdout, argv, cwd, exit, env } from 'node:process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig, isConfigured } from '../lib/ai.mjs';
import { lang, t } from '../lib/i18n.mjs';
import { tokenSummary, lastUsage, resetTokens } from '../lib/tokenmeter.mjs';
import { flushTokenLog, setTokenLogCommand, setTokenLogProject } from '../lib/tokenlog.mjs';
import { createSession } from './session.mjs';
import { touchedPaths } from './engine/review.mjs';
import { planItems, stepTask, stepNeedsMutation, stepRetryTask, stepIsSpecWork } from './engine/plan.mjs';
import { savePlan, loadPlan, markStepDone, specInfo, PLAN_REL } from './engine/planfile.mjs';
import { startReview, logRound, logFixOrder, logFixResult, logVerify, REVIEW_REL } from './engine/reviewfile.mjs';
import { runVerify, verifyCommand } from './engine/verify.mjs';
import { createApprovalPolicy } from './mcp/approval.mjs';
import { frame } from './prompts/text.mjs';
import { createSpinner } from './ui/spinner.mjs';
import { selectInline } from './ui/select.mjs';
import { createScreen } from './ui/screen.mjs';
import { renderAgents } from './ui/agents.mjs';
import { c, banner, bigTitle, stepLine, resultLine, approveText, mutationReport } from './ui/render.mjs';
import { resolveShellPolicy, requiresExplicitApproval } from './tools/trust.mjs';

// Consumo acumulado de la SESIÓN (para /tokens): runTurn resetea el medidor por turno, así que se suma aquí.
const SESSION_TOKENS = { input: 0, output: 0, calls: 0 };

// Auto-aprobación (/auto, o cli.autoApprove en la config): ejecuta write/edit/bash/MCP sin preguntar.
// Es el modo "acepta todo" de Claude Code — más fluido, menos control; se puede alternar en la sesión.
// EXCEPCIÓN (trust.mjs): bash eval-capable (node/npx/python, npm run…) pide confirmación SIEMPRE —
// sin ese freno /auto anularía la única defensa real del shell contra ejecución arbitraria.
const APPROVAL = { auto: false };

// Aviso ÚNICO por sesión: con un equipo de agentes configurado, el texto directo va SOLO al agente
// desarrollador — quien espera al equipo completo (líder→desarrollador→revisor) debe usar /plan.
// Sin esto el usuario ve "trabajando con <modelo local>" y cree que su config no cargó.
const TEAM_HINT = { shown: false };
function maybeTeamHint(session, io) {
  if (TEAM_HINT.shown || !session.modelFor?.('planner')) return;
  TEAM_HINT.shown = true;
  io.print(c.dim(t('cliTeamHint')));
}

// Comandos de sesión: la TUI los sugiere en vivo al teclear "/" (con Tab para completar) — descubribles
// sin tener que saberse /help de memoria.
const SLASH_COMMANDS = [
  { cmd: '/plan', desc: t('cliCmdPlan') },
  { cmd: '/review', desc: t('cliCmdReview') },
  { cmd: '/agents', desc: t('cliCmdAgents') },
  { cmd: '/auto', desc: t('cliCmdAuto') },
  { cmd: '/model', desc: t('cliCmdModel') },
  { cmd: '/skills', desc: t('cliCmdSkills') },
  { cmd: '/mcp', desc: t('cliCmdMcp') },
  { cmd: '/tools', desc: t('cliCmdTools') },
  { cmd: '/tokens', desc: t('cliCmdTokens') },
  { cmd: '/clear', desc: t('cliCmdClear') },
  { cmd: '/help', desc: t('cliCmdHelp') },
  { cmd: '/exit', desc: t('cliCmdExit') }
];

const resolveModel = (cfg) => cfg.models?.code || cfg.model || '';
const fmtK = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n));
const truncate = (v, n = 60) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s.length > n ? s.slice(0, n) + '…' : s; };

const MUTATING = new Set(['write', 'edit', 'bash']);
let APPROVAL_POLICY = createApprovalPolicy({ mutatingTools: [...MUTATING] });
const needsApproval = (tool) => APPROVAL_POLICY.needsApproval(tool);

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

function slashText(cmd, session) {
  if (cmd === '/help') return c.dim(t('cliHelpLine'));
  if (cmd === '/agents') return renderAgents(session.agents.snapshot(), { language: session.language, width: stdout.columns || 80 });
  if (cmd === '/skills') return c.dim('  ' + (session.project.detected?.skills?.join(', ') || t('cliSkillsNone')));
  if (cmd === '/mcp') return c.dim('  ' + (session.mcp.join(', ') || t('cliMcpNone')));
  if (cmd === '/tools') return c.dim('  ' + (session.tools || []).join(' · '));
  if (cmd === '/tokens') return c.dim(t('cliTokensLine', fmtK(SESSION_TOKENS.input), fmtK(SESSION_TOKENS.output), SESSION_TOKENS.calls));
  return c.dim(t('cliUnknownCmd'));
}

// Comandos de sesión comunes a ambos front-ends. Devuelve el texto a imprimir, o null si no era suyo.
// getModel/setModel: /model sin argumento muestra el actual; con argumento cambia EN CALIENTE.
function runSlash(input, session, { getModel, setModel, onClear }) {
  if (input === '/auto' || input.startsWith('/auto ')) {
    const arg = input.slice(5).trim().toLowerCase();
    APPROVAL.auto = arg ? ['on', 'si', 'sí', 'y', 'true', '1'].includes(arg) : !APPROVAL.auto;
    return APPROVAL.auto
      ? c.yellow(t('cliAutoOn'))
      : c.dim(t('cliAutoOff'));
  }
  if (input === '/clear') {
    session.conversation.length = 0;   // reinicia el CONTEXTO (la conversación que viaja al prompt)
    if (onClear) onClear();
    return c.dim(t('cliCleared'));
  }
  if (input === '/model' || input.startsWith('/model ')) {
    const name = input.slice(6).trim();
    if (!name) return c.dim(t('cliModelCurrent', getModel()));
    if (session.setModel(name)) { setModel(name); return c.green(t('cliModelChanged', name)); }
    return c.yellow(t('cliModelChangeFailed'));
  }
  if (input.startsWith('/')) return slashText(input, session);
  return null;
}

// Consumo de un turno de rol (líder/revisor) VISIBLE en pantalla y sumado a /tokens: con roles en la
// nube (OpenRouter…) el usuario paga por token y debe ver cuánto gastó cada rol, no solo el coder.
function reportRoleTokens(io, label) {
  const u = tokenSummary();
  if (!u.calls) return;
  SESSION_TOKENS.input += u.input; SESSION_TOKENS.output += u.output; SESSION_TOKENS.calls += u.calls;
  io.print(c.dim(t('cliRoleTokens', label, fmtK(u.input), fmtK(u.output), u.calls)));
}

// Modo plan (F1): el planner explora en solo lectura y propone un plan numerado; se muestra al usuario
// y SOLO si lo aprueba se ejecuta con el plan inyectado. Devuelve { plan } (aprobado), { direct: true }
// (no hubo plan y el usuario eligió ejecutar la tarea directamente con el coder) o null (cancelado).
async function runPlanTurn(session, goal, io, model) {
  let interrupted = false;
  io.setTurn?.({ interrupt: () => { if (!interrupted) { interrupted = true; io.print(c.yellow(t('cliInterruptPlanner'))); } } });
  io.startThinking(t('cliLeaderPlanning', session.modelFor?.('planner') || model));
  resetTokens();
  try {
    const r = await session.plan(goal, { onStep: (s) => io.print(stepLine(s)), shouldStop: () => interrupted });
    io.stopThinking();
    reportRoleTokens(io, t('cliLeaderLabel', session.modelFor?.('planner') || model));
    if (!r.plan) {
      io.print(c.yellow(t('cliNoPlanYet', r.error || t('cliPlannerNoPlan'))));
      if (r.narrative) io.print(c.dim(t('cliPlannerSaid', r.narrative.slice(0, 200) + (r.narrative.length > 200 ? '…' : ''))));
      if (interrupted) return null;
      // Sin plan no hay callejón sin salida: se ofrece ejecutar la tarea directo con el coder.
      const pick = await io.choose(c.yellow(t('cliRunDirectQ')), [t('cliOptYesDirect'), t('cliOptNoCancel')]);
      return pick === 0 ? { direct: true } : null;
    }
    io.print(c.bold(t('cliPlanProposed')));
    for (const line of r.plan.split('\n')) io.print('  ' + c.cyan('│ ') + line);
    // El líder redacta el SPEC junto al plan: se anuncia aquí (se persiste solo si el plan se aprueba).
    if (r.spec) io.print(c.dim(t('cliSpecWritten')));
    else io.print(c.yellow(t('cliSpecMissing')));
    const pick = await io.choose(c.yellow(t('cliRunPlanQ')), [t('cliOptYesRun'), t('cliOptNoDiscard')]);
    if (pick === 0) return { plan: r.plan, spec: r.spec || '' };
    io.print(c.dim(t('cliPlanDiscarded')));
    return null;
  } catch (e) {
    io.stopThinking();
    io.print(c.red(`✗ ${e.message}`));
    return null;
  } finally {
    io.setTurn?.(null);
    await flushTokenLog();   // el turno del líder también cuesta: persistir al terminar
  }
}

// Ejecuta un plan aprobado PASO A PASO: un turno del coder por ítem, con el orquestador (este código)
// avanzando la lista — así ningún paso se salta ni se declara hecho sin ejecutarse. Si un paso falla,
// el usuario decide si continuar. Devuelve las rutas tocadas en total (para la revisión final).
async function executePlan(session, goal, plan, io, model, opts = {}) {
  const items = planItems(plan);
  const completed = opts.completed || [];   // pasos ya marcados [x] en .chalc/plan.md (modo retomar)
  const projectPath = session.project?.projectPath;
  // Spec del líder desde disco (el que ENLAZA plan.md — en specs/ del proyecto o .chalc): cada orden
  // viaja con SU sección — funciona igual en un plan recién aprobado y al RETOMAR.
  const { rel: specRel, text: spec } = specInfo(projectPath);
  if (spec) io.print(c.dim(t('cliSpecLoaded', specRel)));
  const touched = [];
  for (let i = 0; i < items.length; i++) {
    if (completed[i]) { io.print(c.dim(t('cliStepAlreadyDone', i + 1, items.length, PLAN_REL))); continue; }
    io.print(c.bold(t('cliStepHeader', i + 1, items.length)) + c.dim(' — ' + items[i].replace(/^\d{1,2}[.)]\s*/, '')));
    // Enrutamiento por ROL del paso: los documentos de especificación los redacta el LÍDER — el
    // desarrollador solo recibe órdenes y jamás escribe el spec que gobierna su propio trabajo.
    // Los pasos del líder van SIN focus (planear/especificar requiere el contexto íntegro).
    const specStep = stepIsSpecWork(items[i]);
    if (specStep) io.print(c.dim(t('cliSpecStepByLeader')));
    const turnOpts = { plan, focus: !specStep, role: specStep ? 'planner' : 'coder' };
    let result = await runTurn(session, stepTask(goal, items, i, spec), io, model, turnOpts);
    // Enforcement anti-alucinación: si el paso implica CAMBIOS y el turno terminó "done" sin tocar
    // nada (ni archivo ni comando), el done fue mentira — se re-ejecuta UNA vez con corrección dura.
    if (result?.done && stepNeedsMutation(items[i]) && !mutationReport(result.steps).mutated) {
      io.print(c.yellow(t('cliStepFalseDone')));
      result = await runTurn(session, stepRetryTask(goal, items, i, spec), io, model, turnOpts);
      if (result?.done && !mutationReport(result.steps).mutated) result = { ...result, done: false, error: t('cliStepStillNoChanges') };
    }
    // Marcado DETERMINISTA del checklist: el harness marca [x] solo cuando el paso terminó done y
    // sobrevivió el enforcement de mutación — el modelo jamás marca su propia tarea.
    if (result?.done && projectPath) markStepDone(projectPath, i);
    if (result) touched.push(...touchedPaths(result));
    if (!result || result.interrupted) { io.print(c.dim(t('cliPlanStopped'))); break; }
    if (!result.done) {
      const pick = await io.choose(c.yellow(t('cliStepFailedQ', i + 1)), [t('cliOptYesContinue'), t('cliOptNoStop')]);
      if (pick !== 0) { io.print(c.dim(t('cliPlanStopped'))); break; }
    }
  }
  return [...new Set(touched)];
}

// /plan sin argumento: si hay un checklist pendiente en .chalc/plan.md se ofrece RETOMARLO — un run
// caído se reanuda desde la primera tarea sin marcar, SIN volver a llamar al planner (el líder ya
// dejó sus órdenes escritas). Devuelve { task, paths } si lo manejó, o null si no hay plan pendiente.
async function runResumeTurn(session, io, model) {
  const saved = loadPlan(session.project?.projectPath);
  if (!saved || !saved.pending) return null;
  const pick = await io.choose(
    c.yellow(t('cliResumeQ', saved.pending, saved.items.length, truncate(saved.goal, 70))),
    [t('cliOptYesResume'), t('cliOptNoCancel')]
  );
  if (pick !== 0) { io.print(c.dim(t('cliPlanIntact', PLAN_REL))); return { task: '', paths: [] }; }
  const plan = saved.items.map((it) => it.text).join('\n');
  const paths = await executePlan(session, saved.goal, plan, io, model, { completed: saved.items.map((it) => it.done) });
  if (paths.length) await runReviewTurn(session, saved.goal, paths, io, model);
  return { task: saved.goal, paths };
}

// Lógica de un turno, común a ambos front-ends. `io` abstrae la E/S (print/thinking/confirm).
// io.setTurn (opcional) recibe { interrupt } al empezar y null al terminar: el front-end lo conecta a
// ESC (TUI) o Ctrl+C (scroll) para cancelar el turno sin matar la sesión.
// opts.plan: plan aprobado por el usuario (modo /plan) — viaja al harness como sección requerida.
async function runTurn(session, task, io, model, opts = {}) {
  resetTokens();
  let approveAll = APPROVAL.auto;   // "aprobar todo": activado de entrada si /auto está encendido
  let interrupted = false;
  io.setTurn?.({
    interrupt: () => {
      if (interrupted) return;
      interrupted = true;
      io.print(c.yellow(t('cliInterrupting')));
    }
  });
  const approve = async (action) => {
    if (!needsApproval(action.tool)) return true;
    // /auto (y "a"=aprobar todo) NO cubre bash eval-capable (node/npx/python/npm run…): sin este
    // freno, auto-aprobación + perfil dev anula la única defensa real del shell (la aprobación humana).
    const evalCapable = requiresExplicitApproval(action);
    if (approveAll && !evalCapable) return true;
    const activeId = session.agents?.active(role);
    if (activeId) session.agents.update(activeId, { status: 'waiting_approval', currentAction: describeAction(action) });
    const ans = String(await io.confirm(describeAction(action))).trim().toLowerCase();
    if (activeId) session.agents.update(activeId, { status: 'running' });
    if (['a', 'all', 'todo'].includes(ans)) { approveAll = true; }
    const ok = ['y', 'yes', 's', 'si', 'a', 'all', 'todo'].includes(ans);
    // Feedback inmediato: sin esto, tras aprobar un comando lento (ng generate…) parece que "no hizo nada".
    io.print(ok ? c.dim(t('cliApproved')) : c.dim(t('cliDenied')));
    return ok;
  };
  const onStep = (r) => io.print(stepLine(r));

  // El turno lo ejecuta el rol que decidió el orquestador: 'planner' (líder) para pasos de
  // ESPECIFICACIÓN — el desarrollador jamás redacta los documentos que gobiernan su propio trabajo.
  const role = opts.role === 'planner' ? 'planner' : 'coder';
  io.startThinking(role === 'planner'
    ? t('cliLeaderSpec', session.modelFor?.('planner') || model)
    : t('cliDevWorking', session.modelFor?.('coder') || model));
  let result = null;
  try {
    result = await session.ask(task, { approve, onStep, shouldStop: () => interrupted, plan: opts.plan, focus: opts.focus, role });
    io.stopThinking();
    io.print(resultLine(result));
    // Verificación DETERMINISTA contra las observaciones: el summary del modelo puede alucinar éxito
    // ("Created…") sin haber hecho nada. Aquí se reporta lo que REALMENTE cambió, y se advierte si nada.
    const rep = mutationReport(result.steps);
    if (rep.files.length) io.print(c.dim(t('cliReallyModified', [...new Set(rep.files)].join(', '))));
    if (result.done && !rep.mutated) io.print(c.yellow(t('cliNoMutationWarn')));
    const u = tokenSummary();
    SESSION_TOKENS.input += u.input; SESSION_TOKENS.output += u.output; SESSION_TOKENS.calls += u.calls;
    // contexto = input de la ÚLTIMA llamada (ocupación real de la ventana); el acumulado sumaría pasos pasados.
    io.print(c.dim(t('cliTurnStats', fmtK(lastUsage().input), fmtK(io.numCtx), fmtK(u.output), result.steps.length)));
  } catch (e) {
    io.stopThinking();
    io.print(c.red(`✗ ${e.message}`));
  } finally {
    io.setTurn?.(null);
    await flushTokenLog();   // persistir el gasto POR TURNO: una sesión larga no puede perderlo todo al caer
  }
  return result;
}

// Modo review (F2): el reviewer examina lo tocado en el último turno; si hay hallazgos, se ofrece UNA
// ronda de corrección del coder (acotada: el orquestador no re-revisa solo — el usuario decide).
async function runReviewTurn(session, task, paths, io, model) {
  if (!paths.length) { io.print(c.dim(t('cliNothingToReviewNoFiles'))); return; }
  let interrupted = false;
  io.setTurn?.({ interrupt: () => { if (!interrupted) { interrupted = true; io.print(c.yellow(t('cliInterruptReview'))); } } });
  io.startThinking(t('cliReviewerWorking', session.modelFor?.('reviewer') || model));
  resetTokens();
  let r;
  try {
    r = await session.review(task, { paths, onStep: (s) => io.print(stepLine(s)), shouldStop: () => interrupted });
    io.stopThinking();
    reportRoleTokens(io, t('cliReviewerLabel', session.modelFor?.('reviewer') || model));
  } catch (e) {
    io.stopThinking();
    io.print(c.red(`✗ ${e.message}`));
    return;
  } finally {
    io.setTurn?.(null);
    await flushTokenLog();   // el turno del revisor también cuesta: persistir al terminar
  }
  if (r.empty) { io.print(c.dim(t('cliNothingToReviewNoChanges'))); return; }
  // Bitácora persistida del ciclo de calidad (.chalc/review.md): veredictos, órdenes de corrección
  // literales y resultados — la contraparte del plan.md, para auditar CÓMO se corrigió, no solo qué.
  const projectPath = session.project?.projectPath;
  startReview(projectPath, task, { reviewer: session.modelFor?.('reviewer') || model });
  logRound(projectPath, 1, { ok: r.ok, findings: r.findings });
  if (r.ok) { io.print(c.green(t('cliReviewOk'))); await runVerifyTurn(session, io, model); return; }
  if (!r.findings) { io.print(c.yellow(t('cliReviewNoVerdict', r.error || t('cliReviewInterrupted')))); return; }
  io.print(c.bold(t('cliReviewFindings')));
  for (const line of r.findings.split('\n')) io.print('  ' + c.yellow('│ ') + line);
  const pick = await io.choose(c.yellow(t('cliFixFindingsQ')), [t('cliOptYesFix'), t('cliOptNoLeave')]);
  if (pick === 0) {
    // La instrucción viaja al MODELO → inglés (MODEL_TEXT); los hallazgos van en el idioma del usuario.
    const order = frame(session.language).fixTask(r.findings);
    logFixOrder(projectPath, order);
    const fix = await runTurn(session, order, io, model);
    logFixResult(projectPath, fix || {});
    io.print(c.dim(t('cliReviewLogAt', REVIEW_REL)));
    await runVerifyTurn(session, io, model);
  } else {
    io.print(c.dim(t('cliFindingsNoted')));
  }
}

// Portón de VERIFICACIÓN (compila con la toolchain real del stack): el reviewer solo LEE — el compilador
// no perdona. Si falla, el usuario decide si los errores van al coder como ronda de corrección.
async function runVerifyTurn(session, io, model) {
  const stacks = session.project?.stacks || [];
  const cmd = verifyCommand(stacks);
  if (!cmd) return;   // stack sin chequeo confiable: no se inventa un portón
  for (let round = 1; round <= 2; round++) {
    io.startThinking(t('cliVerifying', cmd));
    const v = await runVerify({ projectPath: session.project.projectPath, stacks });
    io.stopThinking();
    logVerify(session.project.projectPath, round, v);
    if (v.ok) { io.print(c.green(t('cliVerifyOk', cmd))); return; }
    io.print(c.red(t('cliVerifyFailed', cmd, v.timedOut)));
    for (const line of v.output.split('\n').slice(-14)) io.print('  ' + c.dim('│ ') + line);
    if (round === 2) { io.print(c.yellow(t('cliVerifyStillFailing'))); return; }
    const pick = await io.choose(c.yellow(t('cliPassErrorsQ')), [t('cliOptYesFix'), t('cliOptNoLeave')]);
    if (pick !== 0) { io.print(c.dim(t('cliErrorsNoted'))); return; }
    const order = frame(session.language).verifyFixTask(v.command, v.output);
    logFixOrder(session.project.projectPath, order);
    const fix = await runTurn(session, order, io, model);
    logFixResult(session.project.projectPath, fix || {});
  }
}

async function main() {
  const cfg = await loadConfig();
  if (!isConfigured(cfg)) { console.error(t('cliAiNotConfigured')); exit(1); }
  let model = resolveModel(cfg);   // let: /model lo cambia en caliente
  if (!model) { console.error(t('cliNoModel')); exit(1); }

  // Ruta del proyecto (readline temporal; se cierra antes de que la TUI tome stdin en raw).
  const rl = createInterface({ input: stdin, output: stdout });

  // Ctrl+C → salir limpio, DESDE EL INICIO (también en el prompt de la ruta, antes de crear la sesión).
  // Registrar un listener de 'SIGINT' evita que readline rechace la pregunta con AbortError.
  let session = null;
  let closing = false;
  let activeTurn = null;      // { interrupt } mientras corre un turno; null si no. Lo fija io.setTurn.
  let interruptedTurn = null; // el turno ya interrumpido: un 2º Ctrl+C sobre él sale de la app (modelo colgado)
  const shutdown = () => {
    // Primer Ctrl+C con un turno en curso (modo scroll): interrumpe el TURNO, no la sesión.
    if (activeTurn && activeTurn !== interruptedTurn) { interruptedTurn = activeTurn; activeTurn.interrupt(); return; }
    if (closing) process.exit(0);
    closing = true;
    console.log(c.dim('\n' + t('cliBye')));
    Promise.resolve(session?.close?.()).finally(() => { try { rl.close(); } catch { /* ya cerrado */ } process.exit(0); });
  };
  process.on('SIGINT', shutdown);
  rl.on('SIGINT', shutdown);

  const argPath = argv.slice(2).filter((a) => !a.startsWith('-')).join(' ').trim();
  const answer = argPath || (await rl.question(t('cliProjectPathQ', cwd()))).trim();
  const projectPath = resolve(answer || cwd());
  if (!existsSync(projectPath)) { console.error(t('cliPathMissing', projectPath)); rl.close(); exit(1); }
  // Histórico de consumo (specs/002-chalc-tokens): la shell registra como comando 'cli' en este proyecto.
  setTokenLogCommand('cli');
  setTokenLogProject(projectPath);

  const numCtx = cfg.cli?.numCtx || 16384;
  const shellPolicy = resolveShellPolicy(cfg.cli || {});
  APPROVAL_POLICY = createApprovalPolicy({
    mcpMode: cfg.cli?.mcpApproval || cfg.cli?.mcpApprove || cfg.cli?.mcpApprovalMode,
    mutatingTools: [...MUTATING]
  });
  APPROVAL.auto = cfg.cli?.autoApprove === true;   // arranque persistente del modo /auto (opt-in explícito)
  const mcpWarnings = [];
  console.log(c.dim(t('cliLoadingProject')));
  session = await createSession({
    projectPath, cfg: { ...cfg, model },
    language: lang,   // idioma de chalc lang: el modelo escribe sus salidas (plan/summary/hallazgos) en él
    allow: shellPolicy.allow, numCtx,
    budgetTokens: cfg.cli?.budgetTokens || 6000, maxSteps: cfg.cli?.maxSteps || 12,
    onMcpConnect: (id) => console.log(c.dim(t('cliMcpConnecting', id))),
    onMcpWarn: (id, msg) => mcpWarnings.push(`${id}: ${msg}`),
    // El .mcp.json viene del proyecto: abrir un repo ajeno no debe ejecutar sus comandos sin verlos y aprobarlos.
    approveMcpServer: async (id, mcp) => {
      // Local (stdio): se muestra el comando a spawnear. Remoto (HTTP): la URL a la que se conectará.
      const what = mcp.url ? mcp.url : [mcp.command, ...(mcp.args || [])].join(' ');
      const q = mcp.url ? t('cliMcpConnectRemoteQ', id) : t('cliMcpRunLocalQ', id);
      const a = (await rl.question(c.yellow(q) + c.dim(`  →  ${what}  (y/n) `))).trim().toLowerCase();
      return ['y', 'yes', 's', 'si'].includes(a);
    }
  });

  // Muestra los MCP CONFIGURADOS del proyecto (del .mcp.json), marcando con ✗ los que no lograron conectar.
  const infoLine = () => {
    const p = session.project;
    const connected = new Set(session.mcp);
    const bits = [];
    if (p.equipped) {
      if (p.stacks?.length) bits.push(c.dim(p.stacks.join(', ')));
      if (p.detected.skills.length) bits.push(c.dim(`${p.detected.skills.length} skills`));
      const mcp = p.detected.mcpServers || [];
      if (mcp.length) {
        bits.push(c.dim('MCP: ') + mcp.map((id) => (connected.has(id) ? c.dim(id) : `${c.dim(id)}${c.yellow('✗')}`)).join(c.dim(', ')));
        bits.push(c.dim(`MCP approval ${APPROVAL_POLICY.mcpMode}`));
      }
    }
    bits.push(c.dim(`shell ${shellPolicy.profile}`));
    if (p.git?.isRepo) bits.push(c.dim(`git ${p.git.branch}${p.git.clean ? '' : '*'}`));
    return bits.join(c.dim(' · '));
  };

  // Por defecto: TUI con caja fija (título arriba, transcripción con scroll, caja abajo) — la vista elegida
  // por el usuario. CHALC_TUI=0 cae al modo scroll simple si alguna terminal no la renderiza bien.
  const useTui = !!stdout.isTTY && !!stdin.isTTY && env.CHALC_TUI !== '0';

  if (useTui) {
    rl.close();
    // Cabecera FIJA arriba: título CHALC + modelo/proyecto + info del proyecto (no scrollea).
    const header = [
      ...bigTitle('CHALC').split('\n'),
      c.dim(`  ${model} · ${cfg.provider} · ${projectPath}`),
      '  ' + infoLine()
    ];
    // Ctrl+C en cualquier momento (incluso mientras el modelo piensa) → cierre limpio: restaura la terminal,
    // apaga los servidores MCP y sale. El "double Ctrl+C" fuerza la salida si algo tarda en cerrar.
    let exiting = false;
    const screen = createScreen({
      header,
      commands: SLASH_COMMANDS,
      onExit: () => {
        if (exiting) process.exit(0);
        exiting = true;
        screen.close();
        console.log(c.dim(t('cliBye')));
        Promise.resolve(session.close()).finally(() => process.exit(0));
      },
      // ESC: interrumpe el turno en curso (como Claude Code). Si hay una aprobación esperando respuesta,
      // se resuelve con "n" para destrabar el loop y que la interrupción surta efecto en el siguiente paso.
      onEsc: () => {
        if (approvalWaiter) { const w = approvalWaiter; approvalWaiter = null; w('n'); }
        if (activeTurn) activeTurn.interrupt();
      }
    });
    screen.open();
    for (const w of mcpWarnings) screen.print(c.yellow(`  ! MCP ${w}`));
    screen.print(c.dim(t('cliTypeHintTui')));

    // Input SIEMPRE vivo: cada línea se enruta según el momento —respuesta de aprobación pendiente,
    // siguiente tarea esperada, o COLA (escrita mientras el agente trabaja; se procesa al terminar el turno).
    const APPROVAL_ANSWER = /^(y|yes|s|si|sí|n|no|a|all|todo)$/i;
    const queue = [];
    let taskWaiter = null;
    let approvalWaiter = null;
    screen.setOnLine((line) => {
      const txt = line.trim();
      if (!txt) return;
      if (approvalWaiter && APPROVAL_ANSWER.test(txt)) { const w = approvalWaiter; approvalWaiter = null; w(txt.toLowerCase()); return; }
      // Comando de observación FUERA DE BANDA: se responde de inmediato aunque un agente esté
      // trabajando o esperando aprobación. No interrumpe, no pausa y no entra a la cola.
      if (txt === '/agents') { screen.print(renderAgents(session.agents.snapshot(), { language: session.language, width: stdout.columns || 80 })); return; }
      if (taskWaiter) { const w = taskWaiter; taskWaiter = null; w(txt); return; }
      queue.push(txt);
      screen.print(c.dim(t('cliQueued', txt)));
    });
    const nextTask = () => (queue.length ? Promise.resolve(queue.shift()) : new Promise((r) => { taskWaiter = r; }));

    const io = {
      numCtx,
      print: screen.print,
      startThinking: screen.startThinking,
      stopThinking: screen.stopThinking,
      setTurn: (t) => { activeTurn = t; },
      choose: (q, options) => screen.choose(q, options),   // selector con flechas en la caja de entrada
      confirm: async (desc) => {
        screen.stopThinking();
        screen.print(c.yellow(t('cliApproveTuiQ', desc)));   // la pregunta va al tablero
        const a = await new Promise((r) => { approvalWaiter = r; });   // solo consume respuestas y/n/a; lo demás se encola
        screen.startThinking(t('cliThinking'));
        return a;
      }
    };
    const slashCtl = { getModel: () => model, setModel: (m) => { model = m; }, onClear: null };
    try {
      let lastRun = { task: '', paths: [] };   // lo último ejecutado (para /review bajo demanda)
      while (true) {
        const task = await nextTask();
        if (task === '/exit' || task === '/quit') break;
        if (task === '/plan' || task.startsWith('/plan ')) {
          const goal = task.slice(5).trim();
          if (!goal) {
            const resumed = await runResumeTurn(session, io, model);
            if (resumed) { if (resumed.task) lastRun = resumed; } else screen.print(c.dim(t('cliPlanUsage')));
            continue;
          }
          screen.print(c.cyan('› ') + task);
          const p = await runPlanTurn(session, goal, io, model);
          if (p) {
            // Plan aprobado → checklist persistido (retomable) y paso a paso; sin plan → un turno directo.
            if (p.plan && savePlan(session.project?.projectPath, goal, p.plan, { leader: session.modelFor?.('planner') || model, spec: p.spec })) {
              const sRel = specInfo(session.project?.projectPath).rel;
              io.print(c.dim(t('cliPlanSaved', PLAN_REL, sRel)));
            }
            const paths = p.plan
              ? await executePlan(session, goal, p.plan, io, model)
              : touchedPaths(await runTurn(session, goal, io, model, {}));
            lastRun = { task: goal, paths };
            // En modo plan la revisión es automática: quien planifica pidió robustez extra.
            if (paths.length) await runReviewTurn(session, goal, paths, io, model);
          }
          continue;
        }
        if (task === '/review') {
          await runReviewTurn(session, lastRun.task || 'cambios recientes', lastRun.paths, io, model);
          continue;
        }
        const slash = runSlash(task, session, slashCtl);
        if (slash !== null) { screen.print(slash); continue; }
        screen.print(c.cyan('› ') + task);   // eco del mensaje que entra a procesarse
        maybeTeamHint(session, io);
        const result = await runTurn(session, task, io, model);
        lastRun = { task, paths: touchedPaths(result) };
      }
    } finally {
      screen.close();
      await session.close();
    }
    return;
  }

  // ---- Modo scroll (por defecto): input abajo, todo lo demás sale arriba. Robusto en toda terminal. ----
  const spinner = createSpinner(stdout);
  console.log('\n' + bigTitle('CHALC'));
  console.log('\n' + banner({ model, provider: cfg.provider, projectPath, project: session.project }));
  for (const w of mcpWarnings) console.log(c.yellow(`  ! MCP ${w}`));
  console.log(c.dim(t('cliTypeHintScroll')));
  // print limpia el spinner ANTES de escribir (si no, la línea sale pegada a "⠙ pensando…") y lo
  // reanuda solo si el turno sigue pensando.
  let thinking = false;
  const io = {
    numCtx,
    print: (s) => { spinner.stop(); console.log(s); if (thinking) spinner.start(t('cliThinking')); },
    startThinking: (l) => { thinking = true; spinner.start(l); },
    stopThinking: () => { thinking = false; spinner.stop(); },
    setTurn: (t) => { activeTurn = t; },   // Ctrl+C durante el turno → shutdown lo interrumpe (no sale)
    // Selector con flechas; sin TTY (pipe/CI) cae a una pregunta y/n por readline.
    choose: async (q, options) => {
      spinner.stop();
      if (!stdin.isTTY) {
        const a = (await rl.question(q + c.dim(' (y/n) '))).trim().toLowerCase();
        return ['y', 'yes', 's', 'si'].includes(a) ? 0 : options.length - 1;
      }
      rl.pause();
      const r = await selectInline(q, options, { input: stdin, output: stdout });
      rl.resume();
      return r;
    },
    confirm: async (desc) => { spinner.stop(); const a = await rl.question('\n' + approveText(desc) + c.dim('(y/n/a) ')); spinner.start(t('cliThinking')); return a; }
  };
  const slashCtl = { getModel: () => model, setModel: (m) => { model = m; }, onClear: () => console.clear() };
  let lastRun = { task: '', paths: [] };   // lo último ejecutado (para /review bajo demanda)
  while (true) {
    const task = (await rl.question('\n' + c.cyan('› '))).trim();
    if (!task) continue;
    if (task === '/exit' || task === '/quit') break;
    if (task === '/plan' || task.startsWith('/plan ')) {
      const goal = task.slice(5).trim();
      if (!goal) {
        const resumed = await runResumeTurn(session, io, model);
        if (resumed) { if (resumed.task) lastRun = resumed; } else console.log(c.dim(t('cliPlanUsage')));
        continue;
      }
      const p = await runPlanTurn(session, goal, io, model);
      if (p) {
        // Plan aprobado → checklist persistido (retomable) y paso a paso; sin plan → un turno directo.
        if (p.plan && savePlan(session.project?.projectPath, goal, p.plan, { leader: session.modelFor?.('planner') || model, spec: p.spec })) {
          const sRel = specInfo(session.project?.projectPath).rel;
          io.print(c.dim(t('cliPlanSaved', PLAN_REL, sRel)));
        }
        const paths = p.plan
          ? await executePlan(session, goal, p.plan, io, model)
          : touchedPaths(await runTurn(session, goal, io, model, {}));
        lastRun = { task: goal, paths };
        // En modo plan la revisión es automática: quien planifica pidió robustez extra.
        if (paths.length) await runReviewTurn(session, goal, paths, io, model);
      }
      continue;
    }
    if (task === '/review') {
      await runReviewTurn(session, lastRun.task || 'cambios recientes', lastRun.paths, io, model);
      continue;
    }
    const slash = runSlash(task, session, slashCtl);
    if (slash !== null) { console.log(slash); continue; }
    maybeTeamHint(session, io);
    const result = await runTurn(session, task, io, model);
    lastRun = { task, paths: touchedPaths(result) };
  }
  await session.close();
  rl.close();
}

main().catch((e) => {
  if (e?.code === 'ABORT_ERR') { process.exit(0); }   // Ctrl+C durante un prompt: salida limpia, sin stack
  console.error(e);
  exit(1);
});
