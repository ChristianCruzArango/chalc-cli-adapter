// cli/tools/shell.mjs — herramienta de shell del agente. Capas, en orden:
//   1) allowlist: solo comandos cuyo primer token está autorizado (lista vacía = ninguno).
//   2) sin metacaracteres de shell (; & | ` $ > <): un único comando por acción, sin encadenar ni redirigir.
//   3) sin flags de evaluación inline (node -e, python -c, git -c): convierten un comando "seguro" en
//      ejecución arbitraria que quien aprueba no puede leer.
//   4) aprobación humana inyectada antes de ejecutar.
// HONESTIDAD: (1)-(3) reducen la superficie pero NO son un sandbox — con `node script.js` se ejecuta lo
// que diga el script. La defensa real es (4): el usuario ve el comando exacto y decide.
// Se corre CON shell por portabilidad Windows/POSIX (npm→npm.cmd), pero (2) evita la inyección que eso abriría.

import { exec, spawn } from 'node:child_process';

const FORBIDDEN = /[;&|`$><\n\r]/;   // encadenado, redirección y sustitución: prohibidos

// Flags que evalúan código inline u hoyos equivalentes, por comando base. El agente tiene alternativa
// legítima y VISIBLE: escribir un script con write (pasa por aprobación con su contenido) y ejecutarlo.
const INLINE_EVAL = new Map([
  ['node', new Set(['-e', '--eval', '-p', '--print'])],
  ['python', new Set(['-c'])],
  ['python3', new Set(['-c'])],
  ['git', new Set(['-c'])]   // git -c inyecta config ejecutable (core.fsmonitor=<cmd>, etc.)
]);
const DEFAULT_TIMEOUT_MS = 60000;
const MAX_BUFFER = 1024 * 1024;      // 1 MB; salidas mayores se truncan y las comprime CCR aguas arriba

// Baja el ÁRBOL de procesos: en Windows matar solo al shell envolvente deja vivos a los hijos reales
// (npm→node); taskkill /T los baja todos. En POSIX basta con señalar al shell.
function killTree(child) {
  if (!child?.pid || child.exitCode !== null || child.killed) return;
  if (process.platform === 'win32') {
    try { spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); return; } catch { /* fallback abajo */ }
  }
  try { child.kill('SIGTERM'); } catch { /* ya terminó */ }
}

// Entorno NO interactivo para los comandos del agente: el hijo no tiene teclado, así que cualquier CLI que
// pregunte (ng analytics en su 1ª corrida, git pidiendo credenciales…) se quedaría esperando hasta el timeout
// como si "no hiciera nada". CI=true hace que la mayoría use sus defaults sin preguntar.
const NON_INTERACTIVE_ENV = { CI: 'true', NG_CLI_ANALYTICS: 'false', GIT_TERMINAL_PROMPT: '0', NO_COLOR: '1' };

// exec con timeout propio: el timeout nativo de exec mata solo al shell (ver killTree). Nunca rechaza.
// Exportado: el portón de verificación (engine/verify.mjs) corre la toolchain del proyecto con este mismo runner.
export function execBounded(cmd, { cwd, timeoutMs, maxBuffer }) {
  return new Promise((resolve) => {
    let timedOut = false;
    const child = exec(cmd, { cwd, maxBuffer, windowsHide: true, env: { ...process.env, ...NON_INTERACTIVE_ENV } }, (err, stdout, stderr) => {
      clearTimeout(timer);
      if (err) resolve({ code: err.code ?? -1, stdout: stdout || '', stderr: stderr || String(err.message || err), timedOut });
      else resolve({ code: 0, stdout, stderr });
    });
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, timeoutMs);
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
      const tokens = cmd.split(/\s+/);
      const base = tokens[0];
      if (!allow.includes(base)) return { command: cmd, error: `command not allowed: ${base}. Allowed: ${allowed}` };
      const banned = INLINE_EVAL.get(base);
      const evalFlag = banned && tokens.slice(1).find((tk) => banned.has(tk));
      if (evalFlag) return { command: cmd, error: `flag not allowed for ${base}: ${evalFlag}. Write a script file with write and run it.` };
      if (!(await approve({ tool: 'bash', args: { command: cmd } }))) return { command: cmd, error: 'action not approved by the user' };
      return { command: cmd, ...(await execBounded(cmd, { cwd: root, timeoutMs, maxBuffer: MAX_BUFFER })) };
    }
  };

  return { bash };
}
