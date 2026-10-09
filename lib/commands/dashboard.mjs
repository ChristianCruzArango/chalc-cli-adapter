// Comando `chalc dashboard` (spec 006): monitoreo solo-lectura de los workspaces del modo
// worktree. Resuelve la carpeta base (argumento > recordada por chalc feature), sirve la página
// y — en terminal interactiva — pinta la MISMA vista en vivo en la consola (R10). Con --console
// abre el puesto de mando: una ventana de Windows Terminal con el dashboard + un panel por
// workspace (R11). Nunca ejecuta agentes ni modifica repos.

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { t } from '../i18n.mjs';
import { POLL_MS, createMonitor, renderTerminal, scanWorkspaces, startDashboard } from '../dashboard.mjs';
import { recallWorkspaceDir, workspaceBaseDir } from '../workspace.mjs';
import { npmConfigFlag } from '../args.mjs';
import { commandCenterArgs, dashboardWindowArgs, launchDetached } from '../terminals.mjs';
import { CHALC_ROOT, c, cleanPath, disp, flags, positional } from './context.mjs';
import { exitCommand } from './exit.mjs';

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

// Puesto de mando (R11): la ventana la arma wt; ESTE proceso solo la lanza y termina. El panel
// "dashboard" corre este mismo comando (sin --console) y es quien sirve la página + la vista.
// Sin wt se informa el fallo REAL con su propia clave (C-08): antes se anunciaba el puesto de mando
// abierto y, después, llegaba el aviso de «no hay carpeta de workspaces». Lanzador, escaneo y salida
// se inyectan para probarlo sin abrir ventanas.
export async function openCommandCenter(baseDir, port, { launch = launchDetached, scan = scanWorkspaces, print = console.log, warn = console.error } = {}) {
  const workspaces = (await scan(baseDir)).map((w) => ({ id: w.id, dir: join(baseDir, w.id) }));
  const dashCmd = dashboardChildCmd(baseDir, port);
  if (await launch('wt', commandCenterArgs(dashCmd, workspaces))) print(c.green('✓ ' + t('dashConsoleHint')));
  else warn(c.yellow('! ' + t('dashNoWindowsTerminal')));
}

// Vista viva en VENTANA APARTE (R10): se abre una ventana wt dedicada corriendo este mismo comando
// (con --watch) y esta terminal queda libre. Devuelve false si no hay wt (se pinta aquí mismo): se
// ESPERA a saber si arrancó, porque el ENOENT llega como evento y antes se anunciaba un éxito (C-08).
export async function openWindow(baseDir, port, { launch = launchDetached, print = console.log } = {}) {
  if (!(await launch('wt', dashboardWindowArgs(dashboardChildCmd(baseDir, port))))) return false;
  print(c.green('✓ ' + t('dashWindowHint', `http://localhost:${port}`)));
  return true;
}

// Página (R1): si el puerto ya está servido por otro proceso, la vista de consola sigue sola (R11).
// Devuelve la URL servida, o '' si el puerto estaba ocupado.
async function servePage(baseDir, port, monitor) {
  try {
    const { url } = await startDashboard({ baseDir, port, monitor });
    console.log(c.green('✓ ' + t('dashServing', url, disp(baseDir))));
    return url;
  } catch (e) {
    if (e && e.code === 'EADDRINUSE') { console.log(c.yellow('! ' + t('dashPortBusy', port))); return ''; }
    throw e;
  }
}

// Vista viva en consola (R10). \x1b[2J limpia la pantalla, \x1b[3J TAMBIÉN el scrollback (si no,
// cada refresco queda apilado en el historial y "se repite"), \x1b[H cursor a casa: el tablero queda FIJO.
async function watchInConsole(monitor, url) {
  const paint = async () => {
    const state = await monitor.tick();
    const head = c.bold('⚙️  ' + t('dashHdr')) + (url ? '  ' + c.dim(url) : '') + '\n';
    process.stdout.write('\x1b[2J\x1b[3J\x1b[H' + head + '\n' + renderTerminal(state) + '\n' + c.dim(t('dashStopHint')) + '\n');
  };
  await paint();
  setInterval(paint, POLL_MS);   // Ctrl+C termina proceso, servidor e intervalo juntos (R9)
}

export async function runDashboard() {
  console.log('\n' + c.bold('⚙️  ' + t('dashHdr')) + '\n');
  const baseDir = await resolveBaseDir();
  if (!baseDir || !existsSync(baseDir)) { console.error(c.red('✗ ' + t('dashNoBase'))); exitCommand(1); }
  const port = parseInt(String(flags.port || ''), 10) || 4321;

  // npmConfigFlag cubre `npm run dashboard --console` sin `--` (npm se traga el flag). El flag
  // explícito manda (??): el panel hijo corre con --no-console para no reabrir ventanas en bucle
  // aunque herede npm_config_console del entorno.
  if ((flags.console ?? npmConfigFlag('console')) && process.platform === 'win32') return openCommandCenter(baseDir, port);
  // En Windows, sin --watch/--no-watch explícito, la vista nunca se pinta en la terminal donde se ejecutó.
  if (process.platform === 'win32' && flags.watch === undefined && process.stdout.isTTY && await openWindow(baseDir, port)) return;

  // Un monitor COMPARTIDO entre página y consola (R12): un solo historial de actividad por proceso.
  const monitor = createMonitor(baseDir);
  const url = await servePage(baseDir, port, monitor);
  console.log(c.dim('  ' + t('dashStopHint')));
  // TTY pinta y refresca; --no-watch (o salida no interactiva) no.
  if (flags.watch ?? !!process.stdout.isTTY) await watchInConsole(monitor, url);
}
