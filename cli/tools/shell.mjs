// cli/tools/shell.mjs — herramienta de shell del agente. Capas, en orden:
//   1) allowlist: solo comandos cuyo primer token está autorizado (lista vacía = ninguno).
//   2) sin metacaracteres de shell (; & | ` $ > <): un único comando por acción, sin encadenar ni redirigir.
//   3) sin flags de evaluación inline (node -e, python -c, git -c): convierten un comando "seguro" en
//      ejecución arbitraria que quien aprueba no puede leer.
//   4) sin argumentos de ruta que escapen de la raíz del proyecto (/abs, C:\..., ~, ..).
//   5) aprobación humana inyectada antes de ejecutar.
// HONESTIDAD: (1)-(3) reducen la superficie pero NO son un sandbox — con `node script.js` se ejecuta lo
// que diga el script. La defensa real final es (5): el usuario ve el comando exacto y decide.
// No se entrega el texto a un shell en POSIX: validar un mini-parser y después usar exec() dejaba una
// discrepancia peligrosa (por ejemplo escapes que el shell convertía en flags). En Windows se invoca cmd
// solo con argv ya saneado, porque npm.cmd exige ese wrapper.

import { spawn } from 'node:child_process';

const FORBIDDEN = /[;&|`$><\n\r]/;   // encadenado, redirección y sustitución: prohibidos
const WINDOWS_FORBIDDEN = /[&|<>()^%!]/;

// Flags que evalúan código inline u hoyos equivalentes, por comando base. El agente tiene alternativa
// legítima y VISIBLE: escribir un script con write (pasa por aprobación con su contenido) y ejecutarlo.
const INLINE_EVAL = new Map([
  ['node', new Set(['-e', '--eval', '-p', '--print', '--require', '-r', '--import', '--loader', '--experimental-loader'])],
  ['python', new Set(['-c'])],
  ['python3', new Set(['-c'])],
  ['git', new Set(['-c', '--config-env'])]   // git -c inyecta config ejecutable (core.fsmonitor=<cmd>, etc.)
]);
const DEFAULT_TIMEOUT_MS = 60000;
const MAX_BUFFER = 1024 * 1024;      // 1 MB; salidas mayores se truncan y las comprime CCR aguas arriba

// Parser intencionalmente pequeño: acepta palabras y comillas simples/dobles, pero NO escapes. Como no
// hay shell después, `\\-c` llega literal al binario, no se convierte en `-c`. Rechazamos comillas sin cerrar.
export function commandTokens(cmd) {
  const out = [];
  let cur = '';
  let quote = '';
  for (const ch of String(cmd)) {
    if (quote) {
      if (ch === quote) quote = '';
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (/\s/.test(ch)) {
      if (cur) { out.push(cur); cur = ''; }
      continue;
    }
    cur += ch;
  }
  if (quote) throw new Error('unterminated quote');
  if (cur) out.push(cur);
  return out;
}

function pathValue(token) {
  const t = String(token || '').trim();
  if (!t || t === '--') return '';
  const eq = t.indexOf('=');
  return eq > 0 ? t.slice(eq + 1) : t;
}

// Rutas que ESCAPAN del proyecto por traversal (..) o home (~): peligrosas siempre, sean argumento
// posicional o valor de una opción (`npm --prefix=..` escapa igual). Cubre también `~usuario/` (home de
// OTRO usuario); el nombre debe empezar por letra/_ para no confundir semver (`~1.2.3`) con una ruta.
function escapesProjectRoot(token) {
  const value = pathValue(token);
  if (!value) return false;
  if (/^~(?:[A-Za-z_][\w.-]*)?(?:[/\\]|$)/.test(value)) return true;
  return value.replace(/\\/g, '/').split('/').includes('..');
}

// Ruta ABSOLUTA (/etc, C:\...). Solo sospechosa como argumento POSICIONAL (`cat /etc/passwd`); como valor
// de una opción suele ser dato, no un archivo (`ng build --base-href /app/`), y ahí manda la aprobación (5).
function isAbsolutePath(token) {
  const value = pathValue(token);
  return !!value && /^(?:[a-zA-Z]:[\\/]|[/\\]{1,2})/.test(value);
}

// Baja el ÁRBOL de procesos: el runner POSIX crea un process group; Windows usa taskkill /T sobre cmd.exe.
function killTree(child) {
  if (!child?.pid || child.exitCode !== null || child.killed) return;
  if (process.platform === 'win32') {
    try { spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); return; } catch { /* fallback abajo */ }
  }
  try { process.kill(-child.pid, 'SIGTERM'); } catch {
    try { child.kill('SIGTERM'); } catch { /* ya terminó */ }
  }
}

// Entorno NO interactivo para los comandos del agente: el hijo no tiene teclado, así que cualquier CLI que
// pregunte (ng analytics en su 1ª corrida, git pidiendo credenciales…) se quedaría esperando hasta el timeout
// como si "no hiciera nada". CI=true hace que la mayoría use sus defaults sin preguntar.
const NON_INTERACTIVE_ENV = { CI: 'true', NG_CLI_ANALYTICS: 'false', GIT_TERMINAL_PROMPT: '0', NO_COLOR: '1' };

function windowsCommand(file, args) {
  const pieces = [file, ...args];
  if (pieces.some((item) => WINDOWS_FORBIDDEN.test(item))) throw new Error('unsafe character for Windows command runner');
  const quote = (value) => (/\s/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const comspec = process.env.ComSpec || 'cmd.exe';
  return { file: comspec, args: ['/d', '/s', '/c', `"${pieces.map(quote).join(' ')}"`], windowsVerbatimArguments: true };
}

function spawnPortable(file, args, opts) {
  if (process.platform === 'win32') {
    const cmd = windowsCommand(file, args);
    return spawn(cmd.file, cmd.args, { ...opts, windowsVerbatimArguments: cmd.windowsVerbatimArguments });
  }
  return spawn(file, args, { ...opts, detached: true });
}

// Runner sin shell con timeout y salida acotada. Exportado: el portón de verificación reutiliza la misma ruta.
export function execBounded(cmd, { cwd, timeoutMs = DEFAULT_TIMEOUT_MS, maxBuffer = MAX_BUFFER }) {
  return new Promise((resolve) => {
    let timedOut = false;
    let settled = false;
    let stdout = '';
    let stderr = '';
    let timer = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };
    let tokens;
    try { tokens = commandTokens(cmd); }
    catch (e) { finish({ code: -1, stdout: '', stderr: String(e.message || e), timedOut: false }); return; }
    if (!tokens.length) { finish({ code: -1, stdout: '', stderr: 'empty command', timedOut: false }); return; }
    let child;
    try {
      child = spawnPortable(tokens[0], tokens.slice(1), {
        cwd,
        windowsHide: true,
        env: { ...process.env, ...NON_INTERACTIVE_ENV },
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (e) { finish({ code: -1, stdout: '', stderr: String(e.message || e), timedOut: false }); return; }
    const append = (which, chunk) => {
      const text = chunk.toString();
      if (which === 'stdout') stdout += text;
      else stderr += text;
      if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > maxBuffer) {
        stderr += '\noutput exceeded limit';
        killTree(child);
      }
    };
    child.stdout?.on('data', (chunk) => append('stdout', chunk));
    child.stderr?.on('data', (chunk) => append('stderr', chunk));
    child.on('error', (err) => finish({ code: -1, stdout, stderr: stderr || String(err.message || err), timedOut }));
    child.on('close', (code) => finish({ code: code ?? -1, stdout, stderr, timedOut }));
    timer = setTimeout(() => { timedOut = true; killTree(child); }, timeoutMs);
    timer.unref?.();
  });
}

// allow: lista blanca de comandos base. approve({tool,command}) -> boolean.
export function createShellTool({ root, allow = [], approve = async () => true, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!root) throw new Error('createShellTool requiere root.');
  const allowed = allow.join(', ') || '(none)';

  const bash = {
    summary: `Runs ONE single command at the project root (requires approval). NO && ; | nor redirections: one action per command. Allowed: ${allowed}. args: { command }`,
    run: async ({ command } = {}) => {
      const cmd = String(command || '').trim();
      if (!cmd) return { error: 'empty command' };
      if (FORBIDDEN.test(cmd)) return { command: cmd, error: 'shell metacharacters not allowed (; & | ` $ > <); one single command per action' };
      let tokens;
      try { tokens = commandTokens(cmd); }
      catch { return { command: cmd, error: 'unterminated quote' }; }
      const base = tokens[0];
      if (!allow.includes(base)) return { command: cmd, error: `command not allowed: ${base}. Allowed: ${allowed}` };
      const banned = INLINE_EVAL.get(base);
      const evalFlag = banned && tokens.slice(1).find((tk) => banned.has(tk));
      if (evalFlag) return { command: cmd, error: `flag not allowed for ${base}: ${evalFlag}. Write a script file with write and run it.` };
      // Traversal/home (.. ~) se bloquea SIEMPRE (posicional o valor de opción: `npm --prefix=..` escapa).
      // La ruta ABSOLUTA solo si es POSICIONAL: como valor de una opción larga (`--base-href /app/`,
      // `--base-href=/app/`), asignación (`make PREFIX=/usr/local`) o switch MSBuild (`/t:Build`) es dato,
      // no un archivo — bloquearlo daba falsos positivos en builds legítimos. Ahí manda la aprobación (5).
      // Solo las opciones LARGAS (--foo) blindan al token siguiente: un flag corto (-v) suele ser booleano,
      // y tras `--` (fin de opciones POSIX) todo es posicional por definición.
      const args = tokens.slice(1);
      let afterEndOfOptions = false;
      const unsafePath = args.find((tk, i) => {
        if (tk === '--') { afterEndOfOptions = true; return false; }
        if (escapesProjectRoot(tk)) return true;
        if (afterEndOfOptions) return isAbsolutePath(tk);
        const prev = i > 0 ? args[i - 1] : '';
        const optionLike = /^-/.test(tk) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(tk) || /^\/[A-Za-z][A-Za-z0-9]*:/.test(tk);
        const longOptionValue = /^--./.test(prev) && !prev.includes('=');
        return !optionLike && !longOptionValue && isAbsolutePath(tk);
      });
      if (unsafePath) return { command: cmd, error: `path argument outside the project is not allowed: ${unsafePath}` };
      if (!(await approve({ tool: 'bash', args: { command: cmd } }))) return { command: cmd, error: 'action not approved by the user' };
      return { command: cmd, ...(await execBounded(cmd, { cwd: root, timeoutMs, maxBuffer: MAX_BUFFER })) };
    }
  };

  return { bash };
}
