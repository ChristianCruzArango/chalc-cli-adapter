// Comando `chalc dashboard` (spec 006): monitoreo solo-lectura de los workspaces del modo
// worktree. Resuelve la carpeta base (argumento > recordada por chalc feature), sirve la página
// y — en terminal interactiva — pinta la MISMA vista en vivo en la consola (R10). Con --console
// abre el puesto de mando: una ventana de Windows Terminal con el dashboard + un panel por
// workspace (R11). Nunca ejecuta agentes ni modifica repos.

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { t } from '../i18n.mjs';
import { POLL_MS, createMonitor, renderTerminal, scanWorkspaces, startDashboard } from '../dashboard.mjs';
import { recallWorkspaceDir, workspaceBaseDir } from '../workspace.mjs';
import { npmConfigFlag } from '../args.mjs';
import { commandCenterArgs, dashboardWindowArgs } from '../terminals.mjs';
import { CHALC_ROOT, c, cleanPath, disp, flags, positional } from './context.mjs';

// Resuelve la carpeta base con la MISMA normalización que chalc feature (R8 de la spec 005):
// si el usuario pasa D:\MVM y los workspaces viven en D:\MVM\chalc-workspaces, se usa la subcarpeta.
// Comando que corre el panel/ventana hijo: --watch EXPLÍCITO (pinta en su ventana, nunca abre
// otra) y --no-console (aunque herede npm_config_console del entorno, no reabre en bucle).
function dashboardChildCmd(baseDir, port) {
  return [process.execPath, join(CHALC_ROOT, 'bin', 'chalc.mjs'), 'dashboard', baseDir, '--port', String(port), '--watch', '--no-console'];
}

async function resolveBaseDir() {
  const arg = positional[1] ? resolve(cleanPath(positional[1])) : '';
  let baseDir = arg || await recallWorkspaceDir();
  if (baseDir && existsSync(workspaceBaseDir(baseDir))) baseDir = workspaceBaseDir(baseDir);
  return baseDir;
}

export async function runDashboard() {
  console.log('\n' + c.bold('⚙️  ' + t('dashHdr')) + '\n');
  const baseDir = await resolveBaseDir();
  if (!baseDir || !existsSync(baseDir)) { console.error(c.red('✗ ' + t('dashNoBase'))); process.exit(1); }
  const port = parseInt(String(flags.port || ''), 10) || 4321;

  // Puesto de mando (R11): la ventana la arma wt; ESTE proceso solo la lanza y termina. El panel
  // "dashboard" corre este mismo comando (sin --console) y es quien sirve la página + la vista.
  // npmConfigFlag cubre `npm run dashboard --console` sin `--` (npm se traga el flag). El flag
  // explícito manda (??): el panel hijo corre con --no-console para no reabrir ventanas en bucle
  // aunque herede npm_config_console del entorno.
  if ((flags.console ?? npmConfigFlag('console')) && process.platform === 'win32') {
    const workspaces = (await scanWorkspaces(baseDir)).map((w) => ({ id: w.id, dir: join(baseDir, w.id) }));
    const dashCmd = dashboardChildCmd(baseDir, port);
    try {
      const child = spawn('wt', commandCenterArgs(dashCmd, workspaces), { detached: true, stdio: 'ignore' });
      child.on('error', () => console.error(c.yellow('! ' + t('dashNoBase'))));   // wt ausente: no revienta
      child.unref();
      console.log(c.green('✓ ' + t('dashConsoleHint')));
    } catch { console.error(c.yellow('! ' + t('dashConsoleHint'))); }
    return;
  }

  // Vista viva en VENTANA APARTE (R10): en Windows, sin --watch/--no-watch explícito, la vista
  // nunca se pinta en la terminal donde se ejecutó — se abre una ventana wt dedicada corriendo
  // este mismo comando (con --watch) y esta terminal queda libre.
  if (process.platform === 'win32' && flags.watch === undefined && process.stdout.isTTY) {
    try {
      const child = spawn('wt', dashboardWindowArgs(dashboardChildCmd(baseDir, port)), { detached: true, stdio: 'ignore' });
      child.on('error', () => { /* wt ausente: la ventana no abre, pero no revienta */ });
      child.unref();
      console.log(c.green('✓ ' + t('dashWindowHint', `http://localhost:${port}`)));
      return;
    } catch { /* sin wt: cae a pintar aquí mismo */ }
  }

  // Un monitor COMPARTIDO entre página y consola (R12): un solo historial de actividad por proceso.
  const monitor = createMonitor(baseDir);

  // Página (R1): si el puerto ya está servido por otro proceso, la vista de consola sigue sola (R11).
  let url = '';
  try {
    ({ url } = await startDashboard({ baseDir, port, monitor }));
    console.log(c.green('✓ ' + t('dashServing', url, disp(baseDir))));
  } catch (e) {
    if (e && e.code === 'EADDRINUSE') console.log(c.yellow('! ' + t('dashPortBusy', port)));
    else throw e;
  }
  console.log(c.dim('  ' + t('dashStopHint')));

  // Vista viva en consola (R10): TTY pinta y refresca; --no-watch (o salida no interactiva) no.
  const watch = flags.watch ?? !!process.stdout.isTTY;
  if (!watch) return;
  // \x1b[2J limpia la pantalla, \x1b[3J TAMBIÉN el scrollback (si no, cada refresco queda
  // apilado en el historial y "se repite"), \x1b[H cursor a casa: el tablero queda FIJO.
  const paint = async () => {
    const state = await monitor.tick();
    const head = c.bold('⚙️  ' + t('dashHdr')) + (url ? '  ' + c.dim(url) : '') + '\n';
    process.stdout.write('\x1b[2J\x1b[3J\x1b[H' + head + '\n' + renderTerminal(state) + '\n' + c.dim(t('dashStopHint')) + '\n');
  };
  await paint();
  setInterval(paint, POLL_MS);   // Ctrl+C termina proceso, servidor e intervalo juntos (R9)
}
