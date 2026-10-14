// T1 (spec 022, R18, F8) — "sí" con tilde es un SÍ.
//
// El front-end TUI aceptaba "sí" como respuesta de aprobación, pero turns.mjs no lo tenía en su lista
// de afirmativas: el usuario aprobaba y la acción se denegaba. Ahora hay una sola tabla de respuestas.

import test from 'node:test';
import assert from 'node:assert/strict';
import { isApprovalAnswer, isYes, isApproveAll } from '../cli/shell/answers.mjs';
import { tuiInput } from '../cli/shell/frontends.mjs';
import { makeApprove } from '../cli/shell/turns.mjs';

test('F8: toda respuesta que el front-end acepta como aprobación se interpreta igual en el turno', () => {
  for (const a of ['y', 'yes', 's', 'si', 'sí', 'SÍ', 'Sí', 'a', 'all', 'todo']) {
    assert.equal(isApprovalAnswer(a), true, a);
    assert.equal(isYes(a), true, a);
  }
  for (const a of ['n', 'no', 'NO']) {
    assert.equal(isApprovalAnswer(a), true, a);
    assert.equal(isYes(a), false, a);
  }
  for (const a of ['', 'quizá', 'sip']) assert.equal(isApprovalAnswer(a), false, a);
  assert.equal(isApproveAll('todo'), true);
  assert.equal(isApproveAll('sí'), false);
});

test('F8: "sí" escrito en la TUI aprueba la acción', async () => {
  let onLine;
  const screen = { setOnLine: (fn) => { onLine = fn; }, print: () => {} };
  const inbox = tuiInput(screen, {});
  const printed = [];
  const io = { confirm: async () => { const p = inbox.answer(); onLine('sí'); return p; }, print: (s) => printed.push(s) };
  const shell = { approval: { auto: false }, policy: { needsApproval: () => true }, session: {} };
  const approve = makeApprove(shell, io, 'coder');
  assert.equal(await approve({ tool: 'write', args: { path: 'a.js', content: 'x' } }), true);
});
