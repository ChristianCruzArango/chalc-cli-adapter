// T10 (spec 022, R5 + R18, F8) — mutantes de cli/shell/{turns,answers,frontends}.mjs.
// La aprobación de un turno: estado del agente, extracto, "aprobar todo" y el selector sin TTY.

import test from 'node:test';
import assert from 'node:assert/strict';
import { stdin } from 'node:process';
import { isYes, isPlainYes, isApprovalAnswer } from '../cli/shell/answers.mjs';
import { makeApprove } from '../cli/shell/turns.mjs';
import { scrollIo } from '../cli/shell/frontends.mjs';

test('F8: las respuestas se normalizan (espacios y mayúsculas)', () => {
  assert.equal(isYes('  Y  '), true);
  assert.equal(isApprovalAnswer(' no '), true);
  assert.equal(isPlainYes('sí'), true);
  assert.equal(isPlainYes('a'), false);
  assert.equal(isPlainYes(undefined), false);
});

function harness(answers, { agents } = {}) {
  const printed = []; const asked = [];
  const io = { print: (s) => printed.push(String(s)), confirm: async (label) => { asked.push(label); return answers.shift(); } };
  const shell = { approval: { auto: false }, policy: { needsApproval: () => true }, session: { agents } };
  return { approve: makeApprove(shell, io, 'coder'), printed, asked };
}

function agentsSpy() {
  const updates = [];
  return { updates, active: () => 'ag1', update: (id, patch) => updates.push([id, { ...patch }]) };
}

test('R5: con agente activo, se marca esperando aprobación con la etiqueta y luego vuelve a running', async () => {
  const agents = agentsSpy();
  const h = harness(['y'], { agents });
  assert.equal(await h.approve({ tool: 'bash', args: { command: 'ls' } }), true);
  assert.deepEqual(agents.updates, [
    ['ag1', { status: 'waiting_approval', currentAction: 'bash: ls' }],
    ['ag1', { status: 'running' }]
  ]);
});

test('R5: sin extracto (bash) no se imprime nada antes de preguntar', async () => {
  const h = harness(['n']);
  assert.equal(await h.approve({ tool: 'bash', args: { command: 'ls' } }), false);
  assert.equal(h.printed.length, 1, 'solo el feedback aprobado/denegado');
});

test('R5: "a" aprueba el resto del turno; "y" solo la acción', async () => {
  const all = harness(['a']);
  assert.equal(await all.approve({ tool: 'bash', args: { command: 'ls' } }), true);
  assert.equal(await all.approve({ tool: 'write', args: { path: 'x.txt', content: '1' } }), true);
  assert.equal(all.asked.length, 1);
  const one = harness(['y', 'n']);
  assert.equal(await one.approve({ tool: 'bash', args: { command: 'ls' } }), true);
  assert.equal(await one.approve({ tool: 'write', args: { path: 'x.txt', content: '1' } }), false);
  assert.equal(one.asked.length, 2);
});

test('F8: sin TTY, el selector pregunta y/n y "sí" elige la primera opción, otra cosa la última', { skip: stdin.isTTY }, async () => {
  const questions = [];
  const answers = ['sí', 'n'];
  const rl = { question: async (q) => { questions.push(q); return answers.shift(); } };
  const io = scrollIo(rl, {}, 0);
  assert.equal(await io.choose('¿Correr?', ['a', 'b', 'c']), 0);
  assert.equal(await io.choose('¿Correr?', ['a', 'b', 'c']), 2);
  assert.ok(questions[0].startsWith('¿Correr?'));
  assert.ok(questions[0].includes('(y/n)'));
});
