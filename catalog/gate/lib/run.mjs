// run.mjs — ejecución de un comando del repo. Responsabilidad ÚNICA: correr un comando y devolver
// su código de salida y cuánto tardó. Razón de cambio: cómo se lanzan los procesos.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// La salida va HEREDADA a la terminal: el portón no interpreta el stdout de las herramientas (de ahí
// salen los scores inventados), pero el humano sí necesita verlo cuando algo falla.

import { spawn } from 'node:child_process';

// Corre `command` en `cwd`. Nunca lanza: un binario que no existe se reporta como código 127, el
// mismo que usa el shell, para que el llamador lo trate como "herramienta no instalada".
export function runCommand(command, { cwd } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const done = (code) => resolve({ code, ms: Date.now() - started });
    const child = spawn(command, { cwd, shell: true, stdio: 'inherit' });
    child.on('error', () => done(127));
    child.on('close', (code) => done(code ?? 1));
  });
}
