// lib/fatal.mjs — qué hace el CLI ante un fallo que llega hasta arriba. Responsabilidad única: decidir
// el código de salida y el mensaje (sin stack traces), en UN sitio: antes la misma lógica estaba
// copiada en el manejador de excepciones y en el `.catch` final de bin/chalc.mjs (C-07).
//
// Esta librería no llama a `process.exit`: quien instala los manejadores (el entrypoint) le pasa `exit`.

import { CommandExit } from './commands/exit.mjs';

const isAbort = (e) => !!e && (e.code === 'ABORT_ERR' || e.name === 'AbortError');

// El código de salida de un fallo. Un CommandExit ya dijo lo que tenía que decir; Ctrl+C sale limpio
// con 130; el resto se informa con su mensaje y sale con 1.
export function failureCode(err, { print, newline = () => {} }) {
  if (err instanceof CommandExit) return err.exitCode;
  if (isAbort(err)) { newline(); return 130; }
  print(err instanceof Error ? err.message : String(err?.message ?? err));
  return 1;
}

// `uncaughtException` deja el proceso en un estado indefinido (con el dashboard, un servidor y un
// intervalo vivos: colgado para siempre): se informa y se TERMINA. `unhandledRejection` conserva su
// comportamiento de siempre —informar y fijar el código—, que no corta trabajo en curso.
export function installFatalHandlers({ proc = process, print, exit }) {
  const newline = () => proc.stdout.write('\n');
  proc.on('uncaughtException', (e) => {
    proc.exitCode = failureCode(e, { print, newline });
    exit(proc.exitCode);
  });
  proc.on('unhandledRejection', (e) => { proc.exitCode = failureCode(e, { print, newline }); });
}

// SIGTERM/SIGHUP (cerrar la terminal, `kill`) terminan SIN emitir `exit` si nadie los atiende, y entonces
// no corren las limpiezas síncronas (restaurar la terminal, matar hijos de la shell y servidores MCP):
// la terminal quedaba en modo raw y un `ng serve` seguía vivo (O-03). Se sale por `exit`, con 128+n.
const SIGNAL_CODES = { SIGHUP: 1, SIGTERM: 15 };
export function installSignalExit({ proc = process, exit, signals = ['SIGTERM', 'SIGHUP'] }) {
  for (const signal of signals) proc.on(signal, () => exit(128 + SIGNAL_CODES[signal]));
}
