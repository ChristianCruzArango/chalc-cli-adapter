// cli/shell/frontends.mjs — los dos front-ends de la shell. Cada uno solo decide cómo se ve y cómo
// entra la entrada; lo que pasa con cada línea lo decide el despachador común (commands.mjs).
//   - TUI (por defecto en terminal): título arriba, salida con scroll, caja de entrada FIJA abajo.
//   - scroll (fallback si no es TTY o CHALC_TUI=0): banner + spinner, todo sale hacia arriba.
// `ctl.activeTurn` es el turno en curso ({ interrupt }), compartido con el manejador de Ctrl+C.

import { stdin, stdout } from 'node:process';
import { t } from '../../lib/i18n.mjs';
import { flushTokenLog } from '../../lib/tokenlog.mjs';
import { stripControl } from '../../lib/termsafe.mjs';
import { createSpinner } from '../ui/spinner.mjs';
import { selectInline } from '../ui/select.mjs';
import { createScreen } from '../ui/screen.mjs';
import { c, banner, bigTitle, approveText } from '../ui/render.mjs';
import { SLASH_COMMANDS, agentsText, handleInput } from './commands.mjs';

const APPROVAL_ANSWER = /^(y|yes|s|si|sí|n|no|a|all|todo)$/i;

// Input SIEMPRE vivo: cada línea se enruta según el momento —respuesta de aprobación pendiente,
// siguiente tarea esperada, o COLA (escrita mientras el agente trabaja; se procesa al terminar el turno).
function tuiInput(screen, session) {
  const inbox = { queue: [], taskWaiter: null, approvalWaiter: null };
  screen.setOnLine((line) => {
    const txt = line.trim();
    if (!txt) return;
    if (inbox.approvalWaiter && APPROVAL_ANSWER.test(txt)) { const w = inbox.approvalWaiter; inbox.approvalWaiter = null; w(txt.toLowerCase()); return; }
    // Comando de observación FUERA DE BANDA: se responde de inmediato aunque un agente esté
    // trabajando o esperando aprobación. No interrumpe, no pausa y no entra a la cola.
    if (txt === '/agents') { screen.print(agentsText(session)); return; }
    if (inbox.taskWaiter) { const w = inbox.taskWaiter; inbox.taskWaiter = null; w(txt); return; }
    inbox.queue.push(txt);
    screen.print(c.dim(t('cliQueued', txt)));
  });
  inbox.next = () => (inbox.queue.length ? Promise.resolve(inbox.queue.shift()) : new Promise((r) => { inbox.taskWaiter = r; }));
  inbox.answer = () => new Promise((r) => { inbox.approvalWaiter = r; });   // solo consume y/n/a; lo demás se encola
  return inbox;
}

function tuiIo(screen, inbox, ctl, numCtx) {
  return {
    numCtx,
    print: screen.print,
    echo: (task) => screen.print(c.cyan('› ') + task),
    startThinking: screen.startThinking,
    stopThinking: screen.stopThinking,
    setTurn: (turn) => { ctl.activeTurn = turn; },
    choose: (q, options) => screen.choose(q, options),   // selector con flechas en la caja de entrada
    confirm: async (desc) => {
      screen.stopThinking();
      screen.print(c.yellow(t('cliApproveTuiQ', stripControl(desc))));   // la pregunta va al tablero
      const a = await inbox.answer();
      screen.startThinking(t('cliThinking'));
      return a;
    }
  };
}

// TUI: cabecera FIJA arriba (título CHALC + modelo/proyecto + info del proyecto, no scrollea).
export async function runTui(shell, ctl, { header, numCtx, mcpWarnings }) {
  const { session } = shell;
  let inbox = null;
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
      Promise.resolve(session.close()).then(() => flushTokenLog()).finally(() => process.exit(0));
    },
    // ESC: interrumpe el turno en curso (como Claude Code). Si hay una aprobación esperando respuesta,
    // se resuelve con "n" para destrabar el loop y que la interrupción surta efecto en el siguiente paso.
    onEsc: () => {
      if (inbox?.approvalWaiter) { const w = inbox.approvalWaiter; inbox.approvalWaiter = null; w('n'); }
      if (ctl.activeTurn) ctl.activeTurn.interrupt();
    }
  });
  screen.open();
  for (const w of mcpWarnings) screen.print(c.yellow(`  ! MCP ${w}`));
  screen.print(c.dim(t('cliTypeHintTui')));
  inbox = tuiInput(screen, session);
  const io = tuiIo(screen, inbox, ctl, numCtx);
  try {
    while (await handleInput(shell, io, await inbox.next()) !== 'exit') { /* siguiente línea */ }
  } finally {
    screen.close();
    await session.close();
  }
}

function scrollIo(rl, ctl, numCtx) {
  const spinner = createSpinner(stdout);
  // print limpia el spinner ANTES de escribir (si no, la línea sale pegada a "⠙ pensando…") y lo
  // reanuda solo si el turno sigue pensando.
  let thinking = false;
  return {
    numCtx,
    print: (s) => { spinner.stop(); console.log(stripControl(s, { keepStyles: true })); if (thinking) spinner.start(t('cliThinking')); },
    startThinking: (l) => { thinking = true; spinner.start(l); },
    stopThinking: () => { thinking = false; spinner.stop(); },
    clear: () => console.clear(),
    setTurn: (turn) => { ctl.activeTurn = turn; },   // Ctrl+C durante el turno → shutdown lo interrumpe (no sale)
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
    confirm: async (desc) => { spinner.stop(); const a = await rl.question('\n' + approveText(stripControl(desc)) + c.dim('(y/n/a) ')); spinner.start(t('cliThinking')); return a; }
  };
}

// Modo scroll: input abajo, todo lo demás sale arriba. Robusto en toda terminal.
export async function runScroll(shell, ctl, rl, { numCtx, mcpWarnings, provider, projectPath }) {
  console.log('\n' + bigTitle('CHALC'));
  console.log('\n' + banner({ model: shell.model, provider, projectPath, project: shell.session.project }));
  for (const w of mcpWarnings) console.log(c.yellow(`  ! MCP ${stripControl(w)}`));
  console.log(c.dim(t('cliTypeHintScroll')));
  const io = scrollIo(rl, ctl, numCtx);
  for (;;) {
    const task = (await rl.question('\n' + c.cyan('› '))).trim();
    if (task && await handleInput(shell, io, task) === 'exit') break;
  }
  await shell.session.close();
  rl.close();
}
