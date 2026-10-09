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
import { childEnv } from '../../lib/childenv.mjs';
import { killTree, windowsCommand } from '../../lib/proc.mjs';

export { killTree };
import { redactSecretFile } from '../../lib/redact.mjs';
import { pathAndReal } from './fsconfine.mjs';
import { checkCommand, commandTokens, pathValue } from './shellpolicy.mjs';

export { commandTokens };

const DEFAULT_TIMEOUT_MS = 60000;
const MAX_BUFFER = 1024 * 1024;      // 1 MB; salidas mayores se truncan y las comprime CCR aguas arriba


// Tras el SIGTERM del plazo, cuánto se espera antes de SIGKILL, y cuánto después de SIGKILL antes de
// dar la ejecución por terminada aunque algún nieto siga reteniendo los pipes (y `close` no llegue).
const KILL_GRACE_MS = 2000;
const SETTLE_GRACE_MS = 1000;

// Entorno NO interactivo para los comandos del agente: el hijo no tiene teclado, así que cualquier CLI que
// pregunte (ng analytics en su 1ª corrida, git pidiendo credenciales…) se quedaría esperando hasta el timeout
// como si "no hiciera nada". CI=true hace que la mayoría use sus defaults sin preguntar.
const NON_INTERACTIVE_ENV = { CI: 'true', NG_CLI_ANALYTICS: 'false', GIT_TERMINAL_PROMPT: '0', NO_COLOR: '1' };

// Hijos vivos. En POSIX van `detached` (líderes de su grupo, para poder matar el árbol entero), y por
// eso NO mueren con el CLI: un `process.exit` dejaba builds y servidores huérfanos. Al salir se matan.
const live = new Set();
let exitHooked = false;
function track(child) {
  live.add(child);
  child.on('exit', () => live.delete(child));
  if (exitHooked) return;
  exitHooked = true;
  // Síncrono a propósito: en el manejador de `exit` nada asíncrono llega a completarse.
  process.on('exit', () => { for (const c of live) killTree(c, 'SIGKILL'); });
}

/** Cuántos hijos de la shell siguen vivos (para comprobar la limpieza sin inspeccionar el sistema). */
export const liveChildren = () => live.size;

function spawnPortable(file, args, opts) {
  if (process.platform === 'win32') {
    const cmd = windowsCommand(file, args);
    return spawn(cmd.file, cmd.args, { ...opts, windowsVerbatimArguments: cmd.windowsVerbatimArguments });
  }
  const child = spawn(file, args, { ...opts, detached: true });
  track(child);
  return child;
}

const startError = (message) => ({ code: -1, stdout: '', stderr: message, timedOut: false });
const outcome = (run, code) => ({ code, stdout: run.stdout, stderr: run.stderr, timedOut: run.timedOut });

// Corta el proceso: SIGTERM, SIGKILL si lo ignora, y al final se resuelve igualmente aunque algún
// nieto retenga los pipes. Lo usan el plazo vencido y el exceso de salida; actúa una sola vez.
function terminate(run, note) {
  if (run.terminating) return;
  run.terminating = true;
  run.stderr += note;
  killTree(run.child, 'SIGTERM');
  const hard = setTimeout(() => {
    killTree(run.child, 'SIGKILL');
    const settle = setTimeout(() => run.finish(outcome(run, -1)), SETTLE_GRACE_MS);
    settle.unref?.();
  }, KILL_GRACE_MS);
  hard.unref?.();
}

// `chunk` llega ya decodificado por flujo (`setEncoding`): `toString()` por trozo rompía un carácter
// UTF-8 partido entre dos (O-03). El tope se sigue midiendo en bytes.
function collect(run, which, chunk, maxBuffer) {
  if (run.terminating) return;
  run.bytes += Buffer.byteLength(chunk);
  run[which] += chunk;
  if (run.bytes > maxBuffer) terminate(run, '\noutput exceeded limit');
}

// Interrupción del usuario (O-02): se mata el árbol YA (SIGKILL) y se resuelve en el acto, sin esperar
// a que los pipes se cierren —eso podía tardar segundos con un nieto que los retiene—.
function interrupt(run) {
  if (run.settled) return;
  run.terminating = true;
  killTree(run.child, 'SIGKILL');
  run.finish({ ...outcome(run, -1), stderr: run.stderr + '\ninterrupted by the user' });
}

// Runner sin shell con timeout y salida acotada. Exportado: el portón de verificación reutiliza la misma ruta.
// `signal` (opcional): el del turno; abortarlo interrumpe el comando en curso.
export function execBounded(cmd, { cwd, timeoutMs = DEFAULT_TIMEOUT_MS, maxBuffer = MAX_BUFFER, signal }) {
  let tokens;
  try { tokens = commandTokens(cmd); }
  catch (e) { return Promise.resolve(startError(String(e.message || e))); }
  if (!tokens.length) return Promise.resolve(startError('empty command'));
  if (signal?.aborted) return Promise.resolve(startError('interrupted by the user'));
  return new Promise((resolve) => {
    const run = { stdout: '', stderr: '', timedOut: false, terminating: false, bytes: 0, child: null, timer: null, settled: false };
    const onAbort = () => interrupt(run);
    run.finish = (result) => {
      if (run.settled) return;
      run.settled = true;
      if (run.timer) clearTimeout(run.timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(result);
    };
    try {
      run.child = spawnPortable(tokens[0], tokens.slice(1), {
        cwd,
        windowsHide: true,
        env: childEnv(NON_INTERACTIVE_ENV),
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (e) { run.finish(startError(String(e.message || e))); return; }
    run.child.stdout?.setEncoding('utf8');
    run.child.stderr?.setEncoding('utf8');
    run.child.stdout?.on('data', (chunk) => collect(run, 'stdout', chunk, maxBuffer));
    run.child.stderr?.on('data', (chunk) => collect(run, 'stderr', chunk, maxBuffer));
    run.child.on('error', (err) => run.finish({ ...outcome(run, -1), stderr: run.stderr || String(err.message || err) }));
    run.child.on('close', (code) => run.finish(outcome(run, code ?? -1)));
    run.timer = setTimeout(() => { run.timedOut = true; terminate(run, ''); }, timeoutMs);
    run.timer.unref?.();
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

// allow: lista blanca de comandos base. approve({tool,command}) -> boolean.
export function createShellTool({ root, allow = [], approve = async () => true, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!root) throw new Error('createShellTool requiere root.');
  const allowed = allow.join(', ') || '(none)';

  const bash = {
    summary: `Runs ONE single command at the project root (requires approval). NO && ; | nor redirections: one action per command. Allowed: ${allowed}. args: { command }`,
    run: async ({ command } = {}, { signal } = {}) => {
      const cmd = String(command || '').trim();
      const checked = checkCommand(cmd, { root, allow });
      if (checked.error) return checked;
      const { args } = checked;
      if (!(await approve({ tool: 'bash', args: { command: cmd } }))) return { command: cmd, error: 'action not approved by the user' };
      const result = await execBounded(cmd, { cwd: root, timeoutMs, maxBuffer: MAX_BUFFER, signal });
      // `cat .env` y similares: la salida de un comando que nombra un archivo de secretos —por su ruta o
      // por la real de un enlace interno (V-04)— se redacta entera, en el formato de ese archivo.
      const paths = args.flatMap((tk) => pathAndReal(root, pathValue(tk)));
      result.stdout = redactSecretFile(result.stdout, paths);
      result.stderr = redactSecretFile(result.stderr, paths);
      return { command: cmd, ...result };
    }
  };

  return { bash };
}
