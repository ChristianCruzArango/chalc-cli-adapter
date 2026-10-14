// T10 (spec 022, R19, C14/C15) — mutantes: la secuencia de señales con que el portón mata el árbol de un
// hijo (SIGTERM al grupo, espera acotada, SIGKILL solo si sigue vivo, respaldo al hijo) y el escape de `\`
// finales en cmd.exe. El sistema se inyecta: no se lanza ni se mata ningún proceso real.

import test from 'node:test';
import assert from 'node:assert/strict';
import { killTree, shellArg } from '../catalog/gate/lib/run.mjs';

// Un hijo en marcha y un sistema falso que anota cada señal y cada espera. `aliveFor`: cuántas preguntas
// (señal 0) contesta «vivo» el grupo antes de morir; `groupKill`: si se puede señalar al grupo.
function fake({ aliveFor = Infinity, groupKill = true, childKill = () => true } = {}) {
  const calls = [];
  const slept = [];
  let probes = 0;
  const child = { pid: 4242, exitCode: null, signalCode: null, kill: (signal) => { calls.push(['child', signal]); return childKill(signal); } };
  const sys = {
    kill: (pid, signal) => {
      calls.push([pid, signal]);
      if (!groupKill) throw new Error('ESRCH');
      if (signal === 0 && (probes += 1) > aliveFor) throw new Error('ESRCH');
    },
    sleep: (ms) => slept.push(ms)
  };
  return { child, sys, calls, slept };
}

// T10 (spec 022, R19, C14)
test('C14: a group that dies on SIGTERM gets no SIGKILL and no wait', { skip: process.platform === 'win32' }, () => {
  const { child, sys, calls, slept } = fake({ aliveFor: 0 });
  killTree(child, sys);
  assert.deepEqual(calls, [[-4242, 'SIGTERM'], [-4242, 0], [-4242, 0]]);
  assert.deepEqual(slept, []);
});

// T10 (spec 022, R19, C14)
test('C14: a group that ignores SIGTERM is waited for 500 ms in 25 ms steps, then SIGKILLed', { skip: process.platform === 'win32' }, () => {
  const { child, sys, calls, slept } = fake();
  killTree(child, sys);
  assert.deepEqual(calls[0], [-4242, 'SIGTERM']);
  assert.deepEqual(calls.at(-1), [-4242, 'SIGKILL']);
  assert.equal(slept.length, 20);
  assert.ok(slept.every((ms) => ms === 25));
});

// T10 (spec 022, R19, C14)
test('C14: a group that dies during the wait stops the wait and is not SIGKILLed', { skip: process.platform === 'win32' }, () => {
  const { child, sys, calls, slept } = fake({ aliveFor: 3 });
  killTree(child, sys);
  assert.equal(slept.length, 3);
  assert.ok(!calls.some(([, signal]) => signal === 'SIGKILL'));
});

// T10 (spec 022, R19, C14)
test('C14: when the group cannot be signalled, the child itself gets the signal', { skip: process.platform === 'win32' }, () => {
  const { child, sys, calls, slept } = fake({ groupKill: false });
  killTree(child, sys);
  assert.deepEqual(calls, [[-4242, 'SIGTERM'], ['child', 'SIGTERM'], [-4242, 0], [-4242, 0]]);
  assert.deepEqual(slept, []);
});

// T10 (spec 022, R19, C14)
test('C14: if neither the group nor the child can be signalled, nothing else is tried', { skip: process.platform === 'win32' }, () => {
  const { child, sys, calls } = fake({ groupKill: false, childKill: () => { throw new Error('gone'); } });
  killTree(child, sys);
  assert.deepEqual(calls, [[-4242, 'SIGTERM'], ['child', 'SIGTERM']]);
});

// T10 (spec 022, R19, C14)
test('C14: a child that already exited is left alone', () => {
  const { child, sys, calls } = fake();
  killTree({ ...child, exitCode: 0 }, sys);
  killTree({ ...child, signalCode: 'SIGTERM' }, sys);
  killTree({ ...child, pid: undefined }, sys);
  assert.deepEqual(calls, []);
});

// T10 (spec 022, R19, C15)
test('C15: every trailing backslash is doubled on Windows, not only the last one', () => {
  assert.equal(shellArg('C:\\a b\\\\', 'win32'), '"C:\\a b\\\\\\\\"');
});
