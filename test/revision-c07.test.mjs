// C-07 (spec 016, R22) — `uncaughtException` termina el proceso con código distinto de 0 en vez de
// dejarlo vivo en un estado indefinido (con el dashboard, colgado). La misma lógica de fallo sirve al
// `.catch` final del CLI: un solo sitio decide el código y el mensaje.

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { failureCode, installFatalHandlers } from '../lib/fatal.mjs';
import { CommandExit } from '../lib/commands/exit.mjs';

function fakeProcess() {
  const proc = new EventEmitter();
  proc.exitCode = undefined;
  proc.stdout = { write: () => {} };
  return proc;
}

test('R22: failureCode maps CommandExit, Ctrl+C and errors without stack traces', () => {
  const printed = [];
  const print = (m) => printed.push(m);
  assert.equal(failureCode(new CommandExit(3), { print }), 3);
  const abort = new Error('x'); abort.name = 'AbortError';
  assert.equal(failureCode(abort, { print, newline: () => printed.push('⏎') }), 130);
  const abortByCode = new Error('y'); abortByCode.code = 'ABORT_ERR';
  assert.equal(failureCode(abortByCode, { print }), 130);
  assert.equal(failureCode(new Error('falló'), { print }), 1);
  assert.equal(failureCode('texto', { print }), 1);
  assert.deepEqual(printed, ['⏎', 'falló', 'texto']);
});

test('R22: an uncaught exception reports it and terminates the process with code 1', () => {
  const proc = fakeProcess();
  const exits = [];
  const printed = [];
  installFatalHandlers({ proc, print: (m) => printed.push(m), exit: (code) => exits.push(code) });
  proc.emit('uncaughtException', new Error('estado roto'));
  assert.deepEqual(exits, [1]);
  assert.equal(proc.exitCode, 1);
  assert.deepEqual(printed, ['estado roto']);
});

test('R22: an unhandled rejection keeps its previous behaviour (reports and sets the code, no hard exit)', () => {
  const proc = fakeProcess();
  const exits = [];
  installFatalHandlers({ proc, print: () => {}, exit: (code) => exits.push(code) });
  proc.emit('unhandledRejection', new Error('promesa suelta'));
  assert.deepEqual(exits, []);
  assert.equal(proc.exitCode, 1);
});

test('R22: a CommandExit thrown uncaught exits with its own code', () => {
  const proc = fakeProcess();
  const exits = [];
  installFatalHandlers({ proc, print: () => {}, exit: (code) => exits.push(code) });
  proc.emit('uncaughtException', new CommandExit(2));
  assert.deepEqual(exits, [2]);
});
