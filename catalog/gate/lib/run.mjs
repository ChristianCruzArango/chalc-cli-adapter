// run.mjs — ejecución de un comando del repo. Responsabilidad ÚNICA: correr un comando y devolver
// su código de salida y cuánto tardó. Razón de cambio: cómo se lanzan los procesos.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// La salida va HEREDADA a la terminal: el portón no interpreta el stdout de las herramientas (de ahí
// salen los scores inventados), pero el humano sí necesita verlo cuando algo falla.
//
// El portón se lleva a sus hijos consigo. Un mutador tarda media hora; si la corrida se corta
// —Ctrl+C, o se cierra la sesión que la lanzó— sus procesos sobreviven al padre y siguen
// reengendrando hosts de prueba que mantienen bloqueados los binarios del proyecto. La corrida
// siguiente no falla entonces por el código: falla al COMPILAR, con un error de copia de archivos
// que el portón reporta como «los tests no pasan». Es un diagnóstico falso que cuesta una mañana.

import { spawn, spawnSync } from 'node:child_process';

const WINDOWS = process.platform === 'win32';

// Procesos vivos lanzados por el portón.
const running = new Set();

// Cuántos hay en marcha. Existe para que la limpieza se pueda comprobar sin inspeccionar el sistema.
export const runningCount = () => running.size;

// Mata el proceso y TODO lo que haya lanzado.
//
// `child.kill()` no basta: con `shell: true` el hijo es el shell, y quien de verdad trabaja son sus
// nietos. Matar solo al shell los deja huérfanos, que es el fallo que esto viene a evitar.
function killTree(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;

  if (WINDOWS) {
    // Síncrono a propósito: esto también corre desde el manejador de `exit`, donde nada asíncrono
    // llega a completarse.
    try { spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* ya no está */ }
    return;
  }

  // En POSIX el hijo es líder de su grupo (`detached`), así que el negativo alcanza a los nietos.
  try { process.kill(-child.pid, 'SIGKILL'); } catch {
    try { child.kill('SIGKILL'); } catch { /* ya no está */ }
  }
}

// Termina todo lo que el portón tenga en marcha.
export function killRunning() {
  for (const child of running) killTree(child);
  running.clear();
}

// Los manejadores se registran una sola vez, y solo cuando de verdad hay algo que limpiar: importar
// este módulo no debe cambiar cómo responde a señales un proceso que no lanzó nada.
let hooked = false;
function hookOnce() {
  if (hooked) return;
  hooked = true;

  process.on('exit', killRunning);
  // El código convencional de cada señal (128 + su número): 130 es Ctrl+C, no cualquier final. Un
  // supervisor que mandó SIGTERM tiene que poder distinguirlo de una cancelación del usuario.
  for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129], ['SIGBREAK', 149]]) {
    // `process.exit` dispara el manejador de `exit`, que es quien limpia.
    try { process.on(signal, () => process.exit(code)); } catch { /* señal que esta plataforma no tiene */ }
  }
}

// Un argumento que el shell deja tal cual: sin comodines, comillas, espacios ni sustituciones.
const BARE_ARG = /^[\w@+=:,./-]+$/;

// Lo que cmd.exe sigue interpretando incluso entre comillas dobles, y los saltos de línea.
const CMD_UNSAFE = /["%!\r\n\0]/;

export class UnsafeArgError extends Error {}

// Escapa UN argumento que viene de datos (una ruta de git, un globo) para pegarlo a un comando que
// se ejecuta con `shell: true`. El comando del repo sí es shell a propósito —lo escribe el humano en
// `gate.json`—, pero una ruta con `$(…)` o con espacios no puede convertirse en código ni en dos
// argumentos. En POSIX las comillas simples no admiten ninguna expansión; en cmd.exe no hay escape
// completo, así que lo que no se puede citar se rechaza.
export function shellArg(value, platform = process.platform) {
  const text = String(value);
  if (BARE_ARG.test(text)) return text;
  if (platform === 'win32') {
    if (CMD_UNSAFE.test(text)) throw new UnsafeArgError(text);
    return `"${text}"`;
  }
  if (text.includes('\0')) throw new UnsafeArgError(text);
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

// Corre `command` en `cwd`. Nunca lanza: un binario que no existe se reporta como código 127, el
// mismo que usa el shell, para que el llamador lo trate como "herramienta no instalada".
export function runCommand(command, { cwd } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    hookOnce();

    // stdin cerrado: el hijo va en su propio grupo (`detached`, para poder matar el árbol) y por eso no
    // tiene la terminal; si heredara stdin, un prompt interactivo daría EIO o colgaría. Sin stdin,
    // recibe EOF y la herramienta falla con su propio mensaje. La salida sí se hereda.
    const child = spawn(command, { cwd, shell: true, stdio: ['ignore', 'inherit', 'inherit'], detached: !WINDOWS });
    running.add(child);

    const done = (code) => {
      running.delete(child);
      resolve({ code, ms: Date.now() - started });
    };

    child.on('error', () => done(127));
    child.on('close', (code) => done(code ?? 1));
  });
}
