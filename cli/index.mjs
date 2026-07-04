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
import { lang } from '../lib/i18n.mjs';
import { tokenSummary, lastUsage, resetTokens } from '../lib/tokenmeter.mjs';
import { createSession } from './session.mjs';
import { touchedPaths } from './engine/review.mjs';
import { planItems, stepTask, stepNeedsMutation, stepRetryTask, stepIsSpecWork } from './engine/plan.mjs';
import { savePlan, loadPlan, markStepDone, specInfo, PLAN_REL } from './engine/planfile.mjs';
import { startReview, logRound, logFixOrder, logFixResult, logVerify, REVIEW_REL } from './engine/reviewfile.mjs';
import { runVerify, verifyCommand } from './engine/verify.mjs';
import { frame } from './prompts/text.mjs';
import { createSpinner } from './ui/spinner.mjs';
import { selectInline } from './ui/select.mjs';
import { createScreen } from './ui/screen.mjs';
import { c, banner, bigTitle, stepLine, resultLine, approveText, mutationReport } from './ui/render.mjs';

const DEFAULT_ALLOW = ['ls', 'cat', 'dir', 'type', 'git', 'npm', 'npx', 'node', 'pnpm', 'yarn', 'ng', 'dotnet', 'python', 'python3', 'pip', 'pytest', 'go', 'cargo', 'flutter', 'dart', 'mkdir', 'echo'];

// Consumo acumulado de la SESIÓN (para /tokens): runTurn resetea el medidor por turno, así que se suma aquí.
const SESSION_TOKENS = { input: 0, output: 0, calls: 0 };

// Auto-aprobación (/auto, o cli.autoApprove en la config): ejecuta write/edit/bash/MCP sin preguntar.
// Es el modo "acepta todo" de Claude Code — más fluido, menos control; se puede alternar en la sesión.
const APPROVAL = { auto: false };

// Aviso ÚNICO por sesión: con un equipo de agentes configurado, el texto directo va SOLO al agente
// desarrollador — quien espera al equipo completo (líder→desarrollador→revisor) debe usar /plan.
// Sin esto el usuario ve "trabajando con <modelo local>" y cree que su config no cargó.
const TEAM_HINT = { shown: false };
function maybeTeamHint(session, io) {
  if (TEAM_HINT.shown || !session.modelFor?.('planner')) return;
  TEAM_HINT.shown = true;
  io.print(c.dim('  💡 instrucción directa → la ejecuta SOLO el agente DESARROLLADOR. Para el equipo completo (líder planea, desarrollador ejecuta, revisor controla): /plan <tarea>'));
}

// Comandos de sesión: la TUI los sugiere en vivo al teclear "/" (con Tab para completar) — descubribles
// sin tener que saberse /help de memoria.
const SLASH_COMMANDS = [
  { cmd: '/plan', desc: 'planear → aprobar → ejecutar → revisar (multi-modelo)' },
  { cmd: '/review', desc: 'revisar lo último modificado' },
  { cmd: '/auto', desc: 'auto-aprobación on/off' },
  { cmd: '/model', desc: 'ver o cambiar el modelo' },
  { cmd: '/skills', desc: 'skills equipadas' },
  { cmd: '/mcp', desc: 'servidores MCP' },
  { cmd: '/tools', desc: 'herramientas disponibles' },
  { cmd: '/tokens', desc: 'consumo de la sesión' },
  { cmd: '/clear', desc: 'reiniciar la conversación' },
  { cmd: '/help', desc: 'ayuda' },
  { cmd: '/exit', desc: 'salir' }
];

const resolveModel = (cfg) => cfg.models?.code || cfg.model || '';
const fmtK = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n));
const truncate = (v, n = 60) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s.length > n ? s.slice(0, n) + '…' : s; };

const MUTATING = new Set(['write', 'edit', 'bash']);
// MCP: el SERVIDOR ya fue aprobado por el usuario al arrancar. Las tools con nombre de lectura corren sin
// preguntar (como Claude Code); solo las que pueden mutar (generate, run, write…) piden aprobación por acción.
const MCP_READONLY = /^(get|list|read|search|find|show|describe|status|inspect|doc)[_-]?/i;
const needsApproval = (tool) => {
  if (MUTATING.has(tool)) return true;
  if (!tool.startsWith('mcp__')) return false;
  const name = tool.split('__').pop() || '';
  return !MCP_READONLY.test(name);
};

function describeAction(action) {
  const a = action.args || {};
  const p = a.path || a.file || a.filename || a.file_path || '(sin ruta)';
  if (action.tool === 'write') return `write${a.append ? ' (append)' : ''} ${p} (${String(a.content ?? a.text ?? '').length} bytes)`;
  if (action.tool === 'edit') return `edit ${p}`;
  if (action.tool === 'bash') return `bash: ${a.command || a.cmd || ''}`;
  return `${action.tool} ${truncate(a, 80)}`;
}

function slashText(cmd, session) {
  if (cmd === '/help') return c.dim('  /plan <tarea> · /review · /auto [on|off] · /skills · /mcp · /tools · /tokens · /model [nombre] · /clear · /exit   —   ESC interrumpe el turno en curso');
  if (cmd === '/skills') return c.dim('  ' + (session.project.detected?.skills?.join(', ') || 'ninguna'));
  if (cmd === '/mcp') return c.dim('  ' + (session.mcp.join(', ') || 'ninguno'));
  if (cmd === '/tools') return c.dim('  ' + (session.tools || []).join(' · '));
  if (cmd === '/tokens') return c.dim(`  sesión: entrada ${fmtK(SESSION_TOKENS.input)} · salida ${fmtK(SESSION_TOKENS.output)} · ${SESSION_TOKENS.calls} llamadas al modelo`);
  return c.dim('  comando desconocido. /help');
}

// Comandos de sesión comunes a ambos front-ends. Devuelve el texto a imprimir, o null si no era suyo.
// getModel/setModel: /model sin argumento muestra el actual; con argumento cambia EN CALIENTE.
function runSlash(t, session, { getModel, setModel, onClear }) {
  if (t === '/auto' || t.startsWith('/auto ')) {
    const arg = t.slice(5).trim().toLowerCase();
    APPROVAL.auto = arg ? ['on', 'si', 'sí', 'y', 'true', '1'].includes(arg) : !APPROVAL.auto;
    return APPROVAL.auto
      ? c.yellow('  ⚡ auto-aprobación ACTIVADA: write/edit/bash y MCP se ejecutan SIN preguntar (/auto off para volver)')
      : c.dim('  auto-aprobación desactivada: cada acción mutadora vuelve a pedir confirmación');
  }
  if (t === '/clear') {
    session.conversation.length = 0;   // reinicia el CONTEXTO (la conversación que viaja al prompt)
    if (onClear) onClear();
    return c.dim('  conversación reiniciada (el modelo ya no ve los turnos anteriores)');
  }
  if (t === '/model' || t.startsWith('/model ')) {
    const name = t.slice(6).trim();
    if (!name) return c.dim(`  modelo actual: ${getModel()}`);
    if (session.setModel(name)) { setModel(name); return c.green(`  ✓ modelo cambiado a ${name}`); }
    return c.yellow('  ! no se pudo cambiar el modelo en esta sesión');
  }
  if (t.startsWith('/')) return slashText(t, session);
  return null;
}

// Consumo de un turno de rol (líder/revisor) VISIBLE en pantalla y sumado a /tokens: con roles en la
// nube (OpenRouter…) el usuario paga por token y debe ver cuánto gastó cada rol, no solo el coder.
function reportRoleTokens(io, label) {
  const t = tokenSummary();
  if (!t.calls) return;
  SESSION_TOKENS.input += t.input; SESSION_TOKENS.output += t.output; SESSION_TOKENS.calls += t.calls;
  io.print(c.dim(`  tokens ${label}: entrada ${fmtK(t.input)} · salida ${fmtK(t.output)} · ${t.calls} llamada${t.calls === 1 ? '' : 's'}`));
}

// Modo plan (F1): el planner explora en solo lectura y propone un plan numerado; se muestra al usuario
// y SOLO si lo aprueba se ejecuta con el plan inyectado. Devuelve { plan } (aprobado), { direct: true }
// (no hubo plan y el usuario eligió ejecutar la tarea directamente con el coder) o null (cancelado).
async function runPlanTurn(session, goal, io, model) {
  let interrupted = false;
  io.setTurn?.({ interrupt: () => { if (!interrupted) { interrupted = true; io.print(c.yellow('  ■ interrumpiendo el planner…')); } } });
  io.startThinking(`🧠 agente LÍDER planificando (${session.modelFor?.('planner') || model})…`);
  resetTokens();
  try {
    const r = await session.plan(goal, { onStep: (s) => io.print(stepLine(s)), shouldStop: () => interrupted });
    io.stopThinking();
    reportRoleTokens(io, `del líder (${session.modelFor?.('planner') || model})`);
    if (!r.plan) {
      io.print(c.yellow(`  ! sin plan: ${r.error || 'el planner no entregó un plan'}`));
      if (r.narrative) io.print(c.dim('  (respondió: ' + r.narrative.slice(0, 200) + (r.narrative.length > 200 ? '…' : '') + ')'));
      if (interrupted) return null;
      // Sin plan no hay callejón sin salida: se ofrece ejecutar la tarea directo con el coder.
      const pick = await io.choose(c.yellow('  ¿ejecutar la tarea directamente, sin plan?'), ['Sí, directo', 'No, cancelar']);
      return pick === 0 ? { direct: true } : null;
    }
    io.print(c.bold('\n  Plan propuesto:'));
    for (const line of r.plan.split('\n')) io.print('  ' + c.cyan('│ ') + line);
    // El líder redacta el SPEC junto al plan: se anuncia aquí (se persiste solo si el plan se aprueba).
    if (r.spec) io.print(c.dim('  ✍ el líder también redactó el spec de las tareas — al aprobar queda en la carpeta specs/ del proyecto y cada orden viaja con su sección'));
    else io.print(c.yellow('  ⚠ el líder no entregó spec: las órdenes viajarán solo con el plan'));
    const pick = await io.choose(c.yellow('  ¿ejecutar este plan?'), ['Sí, ejecutar', 'No, descartar']);
    if (pick === 0) return { plan: r.plan, spec: r.spec || '' };
    io.print(c.dim('  plan descartado'));
    return null;
  } catch (e) {
    io.stopThinking();
    io.print(c.red(`✗ ${e.message}`));
    return null;
  } finally {
    io.setTurn?.(null);
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
  if (spec) io.print(c.dim(`  📎 spec del líder cargado (${specRel}) — cada tarea recibe su sección`));
  const touched = [];
  for (let i = 0; i < items.length; i++) {
    if (completed[i]) { io.print(c.dim(`  ✔ paso ${i + 1}/${items.length} ya completado (${PLAN_REL})`)); continue; }
    io.print(c.bold(`\n  ▶ paso ${i + 1}/${items.length}`) + c.dim(' — ' + items[i].replace(/^\d{1,2}[.)]\s*/, '')));
    // Enrutamiento por ROL del paso: los documentos de especificación los redacta el LÍDER — el
    // desarrollador solo recibe órdenes y jamás escribe el spec que gobierna su propio trabajo.
    // Los pasos del líder van SIN focus (planear/especificar requiere el contexto íntegro).
    const specStep = stepIsSpecWork(items[i]);
    if (specStep) io.print(c.dim('  ✍ documento de especificación → lo redacta el agente LÍDER (nunca el desarrollador)'));
    const turnOpts = { plan, focus: !specStep, role: specStep ? 'planner' : 'coder' };
    let result = await runTurn(session, stepTask(goal, items, i, spec), io, model, turnOpts);
    // Enforcement anti-alucinación: si el paso implica CAMBIOS y el turno terminó "done" sin tocar
    // nada (ni archivo ni comando), el done fue mentira — se re-ejecuta UNA vez con corrección dura.
    if (result?.done && stepNeedsMutation(items[i]) && !mutationReport(result.steps).mutated) {
      io.print(c.yellow('  ⚠ el paso declaró éxito sin modificar nada — re-ejecutando con corrección…'));
      result = await runTurn(session, stepRetryTask(goal, items, i, spec), io, model, turnOpts);
      if (result?.done && !mutationReport(result.steps).mutated) result = { ...result, done: false, error: 'el paso volvió a terminar sin ejecutar cambios' };
    }
    // Marcado DETERMINISTA del checklist: el harness marca [x] solo cuando el paso terminó done y
    // sobrevivió el enforcement de mutación — el modelo jamás marca su propia tarea.
    if (result?.done && projectPath) markStepDone(projectPath, i);
    if (result) touched.push(...touchedPaths(result));
    if (!result || result.interrupted) { io.print(c.dim('  ejecución del plan detenida')); break; }
    if (!result.done) {
      const pick = await io.choose(c.yellow(`  el paso ${i + 1} no terminó bien — ¿continuar con el siguiente?`), ['Sí, continuar', 'No, detener']);
      if (pick !== 0) { io.print(c.dim('  ejecución del plan detenida')); break; }
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
    c.yellow(`  plan pendiente (${saved.pending} de ${saved.items.length} tareas por hacer): "${truncate(saved.goal, 70)}" — ¿retomarlo?`),
    ['Sí, retomar', 'No, cancelar']
  );
  if (pick !== 0) { io.print(c.dim(`  plan pendiente intacto en ${PLAN_REL}`)); return { task: '', paths: [] }; }
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
      io.print(c.yellow('  ■ interrumpiendo: se detiene al terminar el paso en curso…'));
    }
  });
  const approve = async (action) => {
    if (!needsApproval(action.tool)) return true;
    if (approveAll) return true;
    const ans = String(await io.confirm(describeAction(action))).trim().toLowerCase();
    if (['a', 'all', 'todo'].includes(ans)) { approveAll = true; }
    const ok = approveAll || ['y', 'yes', 's', 'si'].includes(ans);
    // Feedback inmediato: sin esto, tras aprobar un comando lento (ng generate…) parece que "no hizo nada".
    io.print(ok ? c.dim('  ✓ aprobado — ejecutando…') : c.dim('  ✗ denegado'));
    return ok;
  };
  const onStep = (r) => io.print(stepLine(r));

  // El turno lo ejecuta el rol que decidió el orquestador: 'planner' (líder) para pasos de
  // ESPECIFICACIÓN — el desarrollador jamás redacta los documentos que gobiernan su propio trabajo.
  const role = opts.role === 'planner' ? 'planner' : 'coder';
  io.startThinking(role === 'planner'
    ? `🧠 agente LÍDER redactando la especificación (${session.modelFor?.('planner') || model})…`
    : `⚙️ agente DESARROLLADOR trabajando (${session.modelFor?.('coder') || model})…`);
  let result = null;
  try {
    result = await session.ask(task, { approve, onStep, shouldStop: () => interrupted, plan: opts.plan, focus: opts.focus, role });
    io.stopThinking();
    io.print(resultLine(result));
    // Verificación DETERMINISTA contra las observaciones: el summary del modelo puede alucinar éxito
    // ("Created…") sin haber hecho nada. Aquí se reporta lo que REALMENTE cambió, y se advierte si nada.
    const rep = mutationReport(result.steps);
    if (rep.files.length) io.print(c.dim(`  📄 modificado de verdad: ${[...new Set(rep.files)].join(', ')}`));
    if (result.done && !rep.mutated) io.print(c.yellow('  ⚠ este turno NO modificó archivos ni ejecutó comandos — si el resumen dice lo contrario, NO ocurrió'));
    const t = tokenSummary();
    SESSION_TOKENS.input += t.input; SESSION_TOKENS.output += t.output; SESSION_TOKENS.calls += t.calls;
    // contexto = input de la ÚLTIMA llamada (ocupación real de la ventana); el acumulado sumaría pasos pasados.
    io.print(c.dim(`  contexto ${fmtK(lastUsage().input)}/${fmtK(io.numCtx)} · salida ${fmtK(t.output)} · ${result.steps.length} pasos`));
  } catch (e) {
    io.stopThinking();
    io.print(c.red(`✗ ${e.message}`));
  } finally {
    io.setTurn?.(null);
  }
  return result;
}

// Modo review (F2): el reviewer examina lo tocado en el último turno; si hay hallazgos, se ofrece UNA
// ronda de corrección del coder (acotada: el orquestador no re-revisa solo — el usuario decide).
async function runReviewTurn(session, task, paths, io, model) {
  if (!paths.length) { io.print(c.dim('  nada que revisar: el último turno no escribió archivos')); return; }
  let interrupted = false;
  io.setTurn?.({ interrupt: () => { if (!interrupted) { interrupted = true; io.print(c.yellow('  ■ interrumpiendo la revisión…')); } } });
  io.startThinking(`🔍 agente REVISOR revisando (${session.modelFor?.('reviewer') || model})…`);
  resetTokens();
  let r;
  try {
    r = await session.review(task, { paths, onStep: (s) => io.print(stepLine(s)), shouldStop: () => interrupted });
    io.stopThinking();
    reportRoleTokens(io, `del revisor (${session.modelFor?.('reviewer') || model})`);
  } catch (e) {
    io.stopThinking();
    io.print(c.red(`✗ ${e.message}`));
    return;
  } finally {
    io.setTurn?.(null);
  }
  if (r.empty) { io.print(c.dim('  nada que revisar: sin cambios detectables')); return; }
  // Bitácora persistida del ciclo de calidad (.chalc/review.md): veredictos, órdenes de corrección
  // literales y resultados — la contraparte del plan.md, para auditar CÓMO se corrigió, no solo qué.
  const projectPath = session.project?.projectPath;
  startReview(projectPath, task, { reviewer: session.modelFor?.('reviewer') || model });
  logRound(projectPath, 1, { ok: r.ok, findings: r.findings });
  if (r.ok) { io.print(c.green('  ✓ revisión: OK')); await runVerifyTurn(session, io, model); return; }
  if (!r.findings) { io.print(c.yellow(`  ! revisión sin veredicto: ${r.error || 'interrumpida'}`)); return; }
  io.print(c.bold('\n  Hallazgos de la revisión:'));
  for (const line of r.findings.split('\n')) io.print('  ' + c.yellow('│ ') + line);
  const pick = await io.choose(c.yellow('  ¿corregir estos hallazgos?'), ['Sí, corregir', 'No, dejar así']);
  if (pick === 0) {
    // La instrucción viaja al MODELO → inglés (MODEL_TEXT); los hallazgos van en el idioma del usuario.
    const order = frame(session.language).fixTask(r.findings);
    logFixOrder(projectPath, order);
    const fix = await runTurn(session, order, io, model);
    logFixResult(projectPath, fix || {});
    io.print(c.dim(`  📝 bitácora de la revisión en ${REVIEW_REL}`));
    await runVerifyTurn(session, io, model);
  } else {
    io.print(c.dim('  hallazgos anotados; no se corrigió nada'));
  }
}

// Portón de VERIFICACIÓN (compila con la toolchain real del stack): el reviewer solo LEE — el compilador
// no perdona. Si falla, el usuario decide si los errores van al coder como ronda de corrección.
async function runVerifyTurn(session, io, model) {
  const stacks = session.project?.stacks || [];
  const cmd = verifyCommand(stacks);
  if (!cmd) return;   // stack sin chequeo confiable: no se inventa un portón
  for (let round = 1; round <= 2; round++) {
    io.startThinking(`verificando: ${cmd}…`);
    const v = await runVerify({ projectPath: session.project.projectPath, stacks });
    io.stopThinking();
    logVerify(session.project.projectPath, round, v);
    if (v.ok) { io.print(c.green(`  ✓ verificación: ${cmd}`)); return; }
    io.print(c.red(`  ✗ la verificación falló${v.timedOut ? ' (timeout)' : ''}: ${cmd}`));
    for (const line of v.output.split('\n').slice(-14)) io.print('  ' + c.dim('│ ') + line);
    if (round === 2) { io.print(c.yellow('  ! sigue fallando tras la corrección; revísalo manualmente')); return; }
    const pick = await io.choose(c.yellow('  ¿pasar estos errores al coder para corregirlos?'), ['Sí, corregir', 'No, dejar así']);
    if (pick !== 0) { io.print(c.dim('  errores anotados; no se corrigió nada')); return; }
    const order = frame(session.language).verifyFixTask(v.command, v.output);
    logFixOrder(session.project.projectPath, order);
    const fix = await runTurn(session, order, io, model);
    logFixResult(session.project.projectPath, fix || {});
  }
}

async function main() {
  const cfg = await loadConfig();
  if (!isConfigured(cfg)) { console.error('IA no configurada. Ejecútalo primero:  chalc config-ia'); exit(1); }
  let model = resolveModel(cfg);   // let: /model lo cambia en caliente
  if (!model) { console.error('No hay un modelo fijado en la config. Elige uno con:  chalc config-ia'); exit(1); }

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
    console.log(c.dim('\n👋 hasta luego'));
    Promise.resolve(session?.close?.()).finally(() => { try { rl.close(); } catch { /* ya cerrado */ } process.exit(0); });
  };
  process.on('SIGINT', shutdown);
  rl.on('SIGINT', shutdown);

  const argPath = argv.slice(2).filter((a) => !a.startsWith('-')).join(' ').trim();
  const answer = argPath || (await rl.question(`Ruta del proyecto [${cwd()}]: `)).trim();
  const projectPath = resolve(answer || cwd());
  if (!existsSync(projectPath)) { console.error(`No existe la ruta: ${projectPath}`); rl.close(); exit(1); }

  const numCtx = cfg.cli?.numCtx || 16384;
  APPROVAL.auto = cfg.cli?.autoApprove === true;   // arranque persistente del modo /auto (opt-in explícito)
  const mcpWarnings = [];
  console.log(c.dim('cargando proyecto…'));
  session = await createSession({
    projectPath, cfg: { ...cfg, model },
    language: lang,   // idioma de chalc lang: el modelo escribe sus salidas (plan/summary/hallazgos) en él
    allow: cfg.cli?.allow ?? DEFAULT_ALLOW, numCtx,
    budgetTokens: cfg.cli?.budgetTokens || 6000, maxSteps: cfg.cli?.maxSteps || 12,
    onMcpConnect: (id) => console.log(c.dim(`  · conectando MCP ${id}… (npx puede tardar la 1ª vez)`)),
    onMcpWarn: (id, msg) => mcpWarnings.push(`${id}: ${msg}`),
    // El .mcp.json viene del proyecto: abrir un repo ajeno no debe ejecutar sus comandos sin verlos y aprobarlos.
    approveMcpServer: async (id, mcp) => {
      // Local (stdio): se muestra el comando a spawnear. Remoto (HTTP): la URL a la que se conectará.
      const what = mcp.url ? mcp.url : [mcp.command, ...(mcp.args || [])].join(' ');
      const verb = mcp.url ? 'conectar al servidor MCP remoto' : 'ejecutar el servidor MCP';
      const a = (await rl.question(c.yellow(`  ¿${verb} "${id}"?`) + c.dim(`  →  ${what}  (y/n) `))).trim().toLowerCase();
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
      if (mcp.length) bits.push(c.dim('MCP: ') + mcp.map((id) => (connected.has(id) ? c.dim(id) : `${c.dim(id)}${c.yellow('✗')}`)).join(c.dim(', ')));
    }
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
        console.log(c.dim('👋 hasta luego'));
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
    screen.print(c.dim('Escribe una instrucción. Puedes seguir escribiendo mientras trabaja (se encola). /help · /exit'));

    // Input SIEMPRE vivo: cada línea se enruta según el momento —respuesta de aprobación pendiente,
    // siguiente tarea esperada, o COLA (escrita mientras el agente trabaja; se procesa al terminar el turno).
    const APPROVAL_ANSWER = /^(y|yes|s|si|sí|n|no|a|all|todo)$/i;
    const queue = [];
    let taskWaiter = null;
    let approvalWaiter = null;
    screen.setOnLine((line) => {
      const t = line.trim();
      if (!t) return;
      if (approvalWaiter && APPROVAL_ANSWER.test(t)) { const w = approvalWaiter; approvalWaiter = null; w(t.toLowerCase()); return; }
      if (taskWaiter) { const w = taskWaiter; taskWaiter = null; w(t); return; }
      queue.push(t);
      screen.print(c.dim(`  ⏸ en cola: ${t}`));
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
        screen.print(c.yellow(`  ¿aprobar ${desc}? (y/n/a · ESC cancela el turno)`));   // la pregunta va al tablero
        const a = await new Promise((r) => { approvalWaiter = r; });   // solo consume respuestas y/n/a; lo demás se encola
        screen.startThinking('pensando…');
        return a;
      }
    };
    const slashCtl = { getModel: () => model, setModel: (m) => { model = m; }, onClear: null };
    try {
      let lastRun = { task: '', paths: [] };   // lo último ejecutado (para /review bajo demanda)
      while (true) {
        const t = await nextTask();
        if (t === '/exit' || t === '/quit') break;
        if (t === '/plan' || t.startsWith('/plan ')) {
          const goal = t.slice(5).trim();
          if (!goal) {
            const resumed = await runResumeTurn(session, io, model);
            if (resumed) { if (resumed.task) lastRun = resumed; } else screen.print(c.dim('  uso: /plan <tarea>  (o /plan solo, para retomar un plan pendiente)'));
            continue;
          }
          screen.print(c.cyan('› ') + t);
          const p = await runPlanTurn(session, goal, io, model);
          if (p) {
            // Plan aprobado → checklist persistido (retomable) y paso a paso; sin plan → un turno directo.
            if (p.plan && savePlan(session.project?.projectPath, goal, p.plan, { leader: session.modelFor?.('planner') || model, spec: p.spec })) {
              const sRel = specInfo(session.project?.projectPath).rel;
              io.print(c.dim(`  📋 órdenes de trabajo guardadas en ${PLAN_REL}${sRel ? ` + spec del líder en ${sRel}` : ''} — el harness marca [x] al completar cada tarea`));
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
        if (t === '/review') {
          await runReviewTurn(session, lastRun.task || 'cambios recientes', lastRun.paths, io, model);
          continue;
        }
        const slash = runSlash(t, session, slashCtl);
        if (slash !== null) { screen.print(slash); continue; }
        screen.print(c.cyan('› ') + t);   // eco del mensaje que entra a procesarse
        maybeTeamHint(session, io);
        const result = await runTurn(session, t, io, model);
        lastRun = { task: t, paths: touchedPaths(result) };
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
  console.log(c.dim('\nEscribe una instrucción. /help para comandos, /exit para salir.'));
  // print limpia el spinner ANTES de escribir (si no, la línea sale pegada a "⠙ pensando…") y lo
  // reanuda solo si el turno sigue pensando.
  let thinking = false;
  const io = {
    numCtx,
    print: (s) => { spinner.stop(); console.log(s); if (thinking) spinner.start('pensando…'); },
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
    confirm: async (desc) => { spinner.stop(); const a = await rl.question('\n' + approveText(desc) + c.dim('(y/n/a) ')); spinner.start('pensando…'); return a; }
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
        if (resumed) { if (resumed.task) lastRun = resumed; } else console.log(c.dim('  uso: /plan <tarea>  (o /plan solo, para retomar un plan pendiente)'));
        continue;
      }
      const p = await runPlanTurn(session, goal, io, model);
      if (p) {
        // Plan aprobado → checklist persistido (retomable) y paso a paso; sin plan → un turno directo.
        if (p.plan && savePlan(session.project?.projectPath, goal, p.plan, { leader: session.modelFor?.('planner') || model, spec: p.spec })) {
          const sRel = specInfo(session.project?.projectPath).rel;
          io.print(c.dim(`  📋 órdenes de trabajo guardadas en ${PLAN_REL}${sRel ? ` + spec del líder en ${sRel}` : ''} — el harness marca [x] al completar cada tarea`));
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
