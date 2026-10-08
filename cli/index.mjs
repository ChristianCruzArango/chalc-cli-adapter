#!/usr/bin/env node
// cli/index.mjs — shell interactiva del agente, estilo Claude Code. Dos front-ends con la MISMA lógica de turno:
//   - TUI (por defecto en terminal): título arriba, salida con scroll, caja de entrada FIJA abajo.
//   - inline (fallback si no es TTY o CHALC_TUI=0): banner + caja de contexto + spinner.
// Usa EXACTAMENTE el provider/model que el usuario configuró en config-ia. NO quema modelos.
// Este archivo solo ARRANCA: config, ruta, Ctrl+C, sesión y front-end. Los turnos viven en cli/shell/.

import { createInterface } from 'node:readline/promises';
import { stdin, stdout, argv, cwd, exit, env } from 'node:process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig, isConfigured } from '../lib/ai.mjs';
import { lang, t } from '../lib/i18n.mjs';
import { flushTokenLog, setTokenLogCommand, setTokenLogProject } from '../lib/tokenlog.mjs';
import { createSession } from './session.mjs';
import { createApprovalPolicy, describeMcpServer } from './mcp/approval.mjs';
import { stripControl } from '../lib/termsafe.mjs';
import { c, bigTitle } from './ui/render.mjs';
import { resolveShellPolicy } from './tools/trust.mjs';
import { runScroll, runTui } from './shell/frontends.mjs';

const MUTATING = ['write', 'edit', 'bash'];
const resolveModel = (cfg) => cfg.models?.code || cfg.model || '';

// Ctrl+C → salir limpio, DESDE EL INICIO (también en el prompt de la ruta, antes de crear la sesión).
// Registrar un listener de 'SIGINT' evita que readline rechace la pregunta con AbortError.
// Con un turno en curso (modo scroll), el primer Ctrl+C interrumpe el TURNO, no la sesión; un 2º sobre
// el mismo turno sale de la app (modelo colgado). Salir cierra antes la sesión y guarda el gasto del
// turno interrumpido (los turnos completos ya lo guardaron).
function installShutdown(ctl, rl) {
  let closing = false;
  let interruptedTurn = null;
  const shutdown = () => {
    if (ctl.activeTurn && ctl.activeTurn !== interruptedTurn) { interruptedTurn = ctl.activeTurn; ctl.activeTurn.interrupt(); return; }
    if (closing) process.exit(0);
    closing = true;
    console.log(c.dim('\n' + t('cliBye')));
    Promise.resolve(ctl.session?.close?.()).then(() => flushTokenLog()).finally(() => { try { rl.close(); } catch { /* ya cerrado */ } process.exit(0); });
  };
  process.on('SIGINT', shutdown);
  rl.on('SIGINT', shutdown);
}

// El .mcp.json viene del proyecto: abrir un repo ajeno no debe ejecutar sus comandos sin verlos y
// aprobarlos. Se muestra todo lo que decide qué se ejecuta: comando o URL, cwd, entorno y cabeceras.
function mcpServerApproval(rl, projectPath) {
  return async (id, mcp) => {
    const { lines, warnings } = describeMcpServer(mcp, { projectPath });
    console.log(c.yellow(mcp.url ? t('cliMcpConnectRemoteQ', id) : t('cliMcpRunLocalQ', id)));
    for (const line of lines) console.log(c.dim(`    ${stripControl(line)}`));
    for (const w of warnings) console.log(c.red(`    ⚠ ${stripControl(w)}`));
    const a = (await rl.question(c.dim('  (y/n) '))).trim().toLowerCase();
    return ['y', 'yes', 's', 'si'].includes(a);
  };
}

async function openSession(cfg, { model, projectPath, rl, shellPolicy, numCtx, mcpWarnings }) {
  console.log(c.dim(t('cliLoadingProject')));
  return createSession({
    projectPath, cfg: { ...cfg, model },
    language: lang,   // idioma de chalc lang: el modelo escribe sus salidas (plan/summary/hallazgos) en él
    allow: shellPolicy.allow, numCtx,
    budgetTokens: cfg.cli?.budgetTokens || 6000, maxSteps: cfg.cli?.maxSteps || 12,
    onMcpConnect: (id) => console.log(c.dim(t('cliMcpConnecting', id))),
    onMcpWarn: (id, msg) => mcpWarnings.push(`${id}: ${msg}`),
    approveMcpServer: mcpServerApproval(rl, projectPath)
  });
}

// Muestra los MCP CONFIGURADOS del proyecto (del .mcp.json), marcando con ✗ los que no lograron conectar.
function infoLine(shell, shellPolicy) {
  const p = shell.session.project;
  const connected = new Set(shell.session.mcp);
  const bits = [];
  if (p.equipped) {
    if (p.stacks?.length) bits.push(c.dim(p.stacks.join(', ')));
    if (p.detected.skills.length) bits.push(c.dim(`${p.detected.skills.length} skills`));
    const mcp = p.detected.mcpServers || [];
    if (mcp.length) {
      bits.push(c.dim('MCP: ') + mcp.map((id) => (connected.has(id) ? c.dim(id) : `${c.dim(id)}${c.yellow('✗')}`)).join(c.dim(', ')));
      bits.push(c.dim(`MCP approval ${shell.policy.mcpMode}`));
    }
  }
  bits.push(c.dim(`shell ${shellPolicy.profile}`));
  if (p.git?.isRepo) bits.push(c.dim(`git ${p.git.branch}${p.git.clean ? '' : '*'}`));
  return bits.join(c.dim(' · '));
}

// El estado de la shell durante la sesión. Antes eran variables globales del módulo.
function createShellState(session, cfg, model) {
  return {
    session,
    model,   // /model lo cambia en caliente
    tokens: { input: 0, output: 0, calls: 0 },   // consumo acumulado de la SESIÓN (para /tokens)
    // Auto-aprobación (/auto, o cli.autoApprove en la config): ejecuta write/edit/bash/MCP sin preguntar.
    // Es el modo "acepta todo" de Claude Code — más fluido, menos control; se puede alternar en la sesión.
    // EXCEPCIÓN (trust.mjs): bash eval-capable (node/npx/python, npm run…) pide confirmación SIEMPRE.
    approval: { auto: cfg.cli?.autoApprove === true },
    policy: createApprovalPolicy({
      mcpMode: cfg.cli?.mcpApproval || cfg.cli?.mcpApprove || cfg.cli?.mcpApprovalMode,
      mutatingTools: MUTATING
    }),
    teamHintShown: false,
    lastRun: { task: '', paths: [] }   // lo último ejecutado (para /review bajo demanda)
  };
}

async function main() {
  const cfg = await loadConfig();
  if (!isConfigured(cfg)) { console.error(t('cliAiNotConfigured')); exit(1); }
  const model = resolveModel(cfg);
  if (!model) { console.error(t('cliNoModel')); exit(1); }
  // Ruta del proyecto (readline temporal; se cierra antes de que la TUI tome stdin en raw).
  const rl = createInterface({ input: stdin, output: stdout });
  const ctl = { activeTurn: null, session: null };
  installShutdown(ctl, rl);

  const argPath = argv.slice(2).filter((a) => !a.startsWith('-')).join(' ').trim();
  const projectPath = resolve(argPath || (await rl.question(t('cliProjectPathQ', cwd()))).trim() || cwd());
  if (!existsSync(projectPath)) { console.error(t('cliPathMissing', projectPath)); rl.close(); exit(1); }
  // Histórico de consumo (specs/002-chalc-tokens): la shell registra como comando 'cli' en este proyecto.
  setTokenLogCommand('cli');
  setTokenLogProject(projectPath);

  const numCtx = cfg.cli?.numCtx || 16384;
  const shellPolicy = resolveShellPolicy(cfg.cli || {});
  const mcpWarnings = [];
  ctl.session = await openSession(cfg, { model, projectPath, rl, shellPolicy, numCtx, mcpWarnings });
  const shell = createShellState(ctl.session, cfg, model);

  // Por defecto: TUI con caja fija (título arriba, transcripción con scroll, caja abajo) — la vista elegida
  // por el usuario. CHALC_TUI=0 cae al modo scroll simple si alguna terminal no la renderiza bien.
  if (stdout.isTTY && stdin.isTTY && env.CHALC_TUI !== '0') {
    rl.close();
    const header = [...bigTitle('CHALC').split('\n'), c.dim(`  ${model} · ${cfg.provider} · ${projectPath}`), '  ' + infoLine(shell, shellPolicy)];
    await runTui(shell, ctl, { header, numCtx, mcpWarnings });
    return;
  }
  await runScroll(shell, ctl, rl, { numCtx, mcpWarnings, provider: cfg.provider, projectPath });
}

main().catch((e) => {
  if (e?.code === 'ABORT_ERR') { process.exit(0); }   // Ctrl+C durante un prompt: salida limpia, sin stack
  console.error(c.red(`✗ ${e?.message || e}`));          // sin traza: el mensaje es lo accionable
  if (process.env.CHALC_DEBUG) console.error(e);
  flushTokenLog().finally(() => exit(1));
});
