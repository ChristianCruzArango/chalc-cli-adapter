// cli/shell/commands.mjs — qué hace la shell con cada línea que escribe el usuario: comandos de sesión
// (/auto, /model, /clear, /tokens…), /plan (nuevo o retomado), /review, o una tarea para el agente.
// Es el MISMO despachador para los dos front-ends: antes cada bucle llevaba su copia.

import { stdout } from 'node:process';
import { t } from '../../lib/i18n.mjs';
import { touchedPaths } from '../engine/review.mjs';
import { savePlan, loadPlan, specInfo, PLAN_REL } from '../engine/planfile.mjs';
import { renderAgents } from '../ui/agents.mjs';
import { c, truncate } from '../ui/render.mjs';
import { executePlan, fmtK, modelOf, runPlanTurn, runTurn } from './turns.mjs';
import { runReviewTurn } from './quality.mjs';

// Comandos de sesión: la TUI los sugiere en vivo al teclear "/" (con Tab para completar) — descubribles
// sin tener que saberse /help de memoria.
export const SLASH_COMMANDS = [
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

// El tablero de agentes (/agents). La TUI lo responde también FUERA DE BANDA, con un turno en curso.
export const agentsText = (session) => renderAgents(session.agents.snapshot(), { language: session.language, width: stdout.columns || 80 });

function slashText(cmd, shell) {
  const { session } = shell;
  if (cmd === '/help') return c.dim(t('cliHelpLine'));
  if (cmd === '/agents') return agentsText(session);
  if (cmd === '/skills') return c.dim('  ' + (session.project.detected?.skills?.join(', ') || t('cliSkillsNone')));
  if (cmd === '/mcp') return c.dim('  ' + (session.mcp.join(', ') || t('cliMcpNone')));
  if (cmd === '/tools') return c.dim('  ' + (session.tools || []).join(' · '));
  if (cmd === '/tokens') return c.dim(t('cliTokensLine', fmtK(shell.tokens.input), fmtK(shell.tokens.output), shell.tokens.calls));
  return c.dim(t('cliUnknownCmd'));
}

// Comandos de sesión. Devuelve el texto a imprimir, o null si la línea no era un comando.
// /model sin argumento muestra el actual; con argumento lo cambia EN CALIENTE.
function runSlash(shell, io, input) {
  if (input === '/auto' || input.startsWith('/auto ')) {
    const arg = input.slice(5).trim().toLowerCase();
    shell.approval.auto = arg ? ['on', 'si', 'sí', 'y', 'true', '1'].includes(arg) : !shell.approval.auto;
    return shell.approval.auto ? c.yellow(t('cliAutoOn')) : c.dim(t('cliAutoOff'));
  }
  if (input === '/clear') {
    shell.session.conversation.length = 0;   // reinicia el CONTEXTO (la conversación que viaja al prompt)
    io.clear?.();
    return c.dim(t('cliCleared'));
  }
  if (input === '/model' || input.startsWith('/model ')) {
    const name = input.slice(6).trim();
    if (!name) return c.dim(t('cliModelCurrent', shell.model));
    if (shell.session.setModel(name)) { shell.model = name; return c.green(t('cliModelChanged', name)); }
    return c.yellow(t('cliModelChangeFailed'));
  }
  if (input.startsWith('/')) return slashText(input, shell);
  return null;
}

// Aviso ÚNICO por sesión: con un equipo de agentes configurado, el texto directo va SOLO al agente
// desarrollador — quien espera al equipo completo (líder→desarrollador→revisor) debe usar /plan.
// Sin esto el usuario ve "trabajando con <modelo local>" y cree que su config no cargó.
function maybeTeamHint(shell, io) {
  if (shell.teamHintShown || !shell.session.modelFor?.('planner')) return;
  shell.teamHintShown = true;
  io.print(c.dim(t('cliTeamHint')));
}

// /plan sin argumento: si hay un checklist pendiente en .chalc/plan.md se ofrece RETOMARLO — un run
// caído se reanuda desde la primera tarea sin marcar, SIN volver a llamar al planner (el líder ya
// dejó sus órdenes escritas). Devuelve { task, paths } si lo manejó, o null si no hay plan pendiente.
async function runResumeTurn(shell, io) {
  const saved = loadPlan(shell.session.project?.projectPath);
  if (!saved || !saved.pending) return null;
  const pick = await io.choose(
    c.yellow(t('cliResumeQ', saved.pending, saved.items.length, truncate(saved.goal, 70))),
    [t('cliOptYesResume'), t('cliOptNoCancel')]
  );
  if (pick !== 0) { io.print(c.dim(t('cliPlanIntact', PLAN_REL))); return { task: '', paths: [] }; }
  const plan = saved.items.map((it) => it.text).join('\n');
  const paths = await executePlan(shell, io, { goal: saved.goal, plan, completed: saved.items.map((it) => it.done) });
  if (paths.length) await runReviewTurn(shell, io, saved.goal, paths);
  return { task: saved.goal, paths };
}

// /plan <objetivo>: plan aprobado → checklist persistido (retomable) y paso a paso; sin plan → un
// turno directo. En modo plan la revisión es automática: quien planifica pidió robustez extra.
async function planCommand(shell, io, task) {
  const goal = task.slice(5).trim();
  if (!goal) {
    const resumed = await runResumeTurn(shell, io);
    if (resumed) { if (resumed.task) shell.lastRun = resumed; } else io.print(c.dim(t('cliPlanUsage')));
    return;
  }
  io.echo?.(task);
  const p = await runPlanTurn(shell, io, goal);
  if (!p) return;
  const projectPath = shell.session.project?.projectPath;
  if (p.plan && savePlan(projectPath, goal, p.plan, { leader: modelOf(shell, 'planner'), spec: p.spec })) {
    io.print(c.dim(t('cliPlanSaved', PLAN_REL, specInfo(projectPath).rel)));
  }
  const paths = p.plan ? await executePlan(shell, io, { goal, plan: p.plan }) : touchedPaths(await runTurn(shell, io, goal, {}));
  shell.lastRun = { task: goal, paths };
  if (paths.length) await runReviewTurn(shell, io, goal, paths);
}

// Una línea del usuario. Devuelve 'exit' si pidió salir. `shell.lastRun` guarda lo último ejecutado
// (para /review bajo demanda).
export async function handleInput(shell, io, task) {
  if (task === '/exit' || task === '/quit') return 'exit';
  if (task === '/plan' || task.startsWith('/plan ')) return planCommand(shell, io, task);
  if (task === '/review') return runReviewTurn(shell, io, shell.lastRun.task || 'recent changes', shell.lastRun.paths);
  const slash = runSlash(shell, io, task);
  if (slash !== null) { io.print(slash); return undefined; }
  io.echo?.(task);   // eco del mensaje que entra a procesarse (solo donde la entrada no queda a la vista)
  maybeTeamHint(shell, io);
  const result = await runTurn(shell, io, task);
  shell.lastRun = { task, paths: touchedPaths(result) };
  return undefined;
}
