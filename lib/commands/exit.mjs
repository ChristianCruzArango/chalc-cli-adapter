// lib/commands/exit.mjs — terminar un comando con un código, SIN `process.exit`.
//
// `process.exit` a mitad de un comando rompía dos garantías de `bin/chalc.mjs`: el log de tokens
// —guardado «SIEMPRE», incluso tras llamadas de IA ya pagadas— no llegaba a escribirse, y en Windows
// matar el proceso justo después de un `fetch` dispara una aserción de libuv. Un comando lanza
// CommandExit; el entrypoint lo convierte en `process.exitCode` y deja que el proceso termine solo.

export class CommandExit extends Error {
  constructor(code = 1) {
    super(`exit ${code}`);
    this.name = 'CommandExit';
    this.exitCode = code;
  }
}

/** Termina el comando con `code` (130 = cancelado por el usuario, como en el resto de la CLI). */
export function exitCommand(code = 1) {
  throw new CommandExit(code);
}
