// T1 (spec 022, R18/R19, F7 + C7) — el portón de verificación no tumba la sesión ni se salta la política.
//
// Un `verify.command` con una comilla sin cerrar hacía lanzar a `verifyAllowed` tras cada /plan o /review
// y la excepción mataba la shell interactiva. Y `verifyAllowed` solo miraba el binario base: con
// `node -e …` pasaba lo que la shell del agente rechaza. Ahora reusa `checkCommand`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyAllowed } from '../cli/engine/verify.mjs';
import { runVerifyTurn, runReviewTurn } from '../cli/shell/quality.mjs';
import { DEV_ALLOW } from '../cli/tools/trust.mjs';

test('F7: verifyAllowed con un comando mal formado devuelve false, no lanza', () => {
  assert.equal(verifyAllowed('npm "sin cerrar', DEV_ALLOW), false);
});

test('C7: verifyAllowed aplica la misma política que la shell (checkCommand)', () => {
  assert.equal(verifyAllowed('node -e "require(1)"', DEV_ALLOW), false);
  assert.equal(verifyAllowed('npm test ; rm -rf x', DEV_ALLOW), false);
  assert.equal(verifyAllowed('git -c core.pager=x log', DEV_ALLOW), false);
  assert.equal(verifyAllowed('dotnet build --nologo', DEV_ALLOW), true);
  assert.equal(verifyAllowed('npm test', DEV_ALLOW, { root: tmpdir() }), true);
});

const ioStub = () => {
  const printed = [];
  return { printed, print: (s) => printed.push(String(s)), startThinking() {}, stopThinking() {}, setTurn() {}, choose: async () => 1 };
};

test('F7: runVerifyTurn con verify.command mal formado no lanza', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-f7-'));
  try {
    await mkdir(join(dir, '.chalc'), { recursive: true });
    await writeFile(join(dir, '.chalc', 'gate.json'), JSON.stringify({ verify: { command: 'npm "sin cerrar' } }));
    const io = ioStub();
    const shell = { session: { project: { projectPath: dir, stacks: [] }, allow: DEV_ALLOW } };
    await assert.doesNotReject(runVerifyTurn(shell, io));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('F7: un fallo inesperado en runReviewTurn/runVerifyTurn se informa y no mata la sesión', async () => {
  const boom = { get project() { throw new Error('boom'); }, review: async () => ({ ok: true }), modelFor: () => 'm' };
  const io = ioStub();
  await assert.doesNotReject(runReviewTurn({ session: boom, model: 'm' }, io, 'tarea', ['a.js']));
  assert.ok(io.printed.some((l) => l.includes('boom')));
  const io2 = ioStub();
  await assert.doesNotReject(runVerifyTurn({ session: boom, model: 'm' }, io2));
  assert.ok(io2.printed.some((l) => l.includes('boom')));
});
