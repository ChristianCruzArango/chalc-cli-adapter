// Limpieza de los procesos que lanza el portón.
//
// Un mutador puede tardar media hora. Si la corrida se corta —Ctrl+C, o se cierra la sesión que la
// lanzó—, sus procesos sobreviven al padre y siguen reengendrando hosts de prueba que mantienen
// bloqueados los binarios del proyecto. La corrida siguiente entonces no falla por el código: falla
// al COMPILAR, con un error de copia de archivos, y el portón lo reporta como "los tests no pasan".
// Diagnosticar eso cuesta una mañana, así que el portón se lleva a sus hijos consigo.

import test from 'node:test';
import assert from 'node:assert/strict';
import { runCommand, killRunning, runningCount } from '../catalog/gate/lib/run.mjs';

// Un comando que no termina solo.
const FOREVER = `node -e "setInterval(() => {}, 1000)"`;

test('killRunning ends a command that is still running', async () => {
  const corriendo = runCommand(FOREVER);

  // El proceso ya está en marcha antes de matarlo.
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(runningCount(), 1, 'el portón sabe qué lanzó');

  killRunning();

  const { code } = await corriendo;
  assert.notEqual(code, undefined, 'la promesa resuelve: no queda colgada');
  assert.equal(runningCount(), 0, 'no queda nada anotado');
});

test('runCommand stops tracking a command that finished on its own', async () => {
  await runCommand(`node -e "process.exit(0)"`);

  assert.equal(runningCount(), 0);
});

test('killRunning is harmless when nothing is running', async () => {
  killRunning();

  assert.equal(runningCount(), 0);
});
