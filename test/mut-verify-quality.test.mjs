// T10 (spec 022, R19, F7 + C7 + V-02) — mutantes de cli/engine/verify.mjs y cli/shell/quality.mjs.
// El portón de verificación: qué permite el perfil, qué salida devuelve y cuándo se ofrece tras la revisión.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { t } from '../lib/i18n.mjs';
import { verifyAllowed, runVerify } from '../cli/engine/verify.mjs';
import { runReviewTurn, runVerifyTurn } from '../cli/shell/quality.mjs';

test('C7: un comando nulo nunca se permite, sea cual sea la allowlist', () => {
  assert.equal(verifyAllowed(null, ['Stryker']), false);
  assert.equal(verifyAllowed(undefined, ['ls']), false);
});

test('F7: si la política lanza (raíz inexistente) verifyAllowed devuelve false estricto', () => {
  assert.equal(verifyAllowed('ls x', ['ls'], { root: '/no/existe/chalc-zz' }), false);
});

test('R19: la salida de un fallo junta stdout y stderr, sin relleno ni espacios sobrantes', async (t2) => {
  const dir = await tempDir(t2);
  await writeFile(join(dir, 'both.mjs'), "process.stdout.write('OUT\\n'); process.stderr.write('ERR\\n'); process.exit(3);\n");
  await writeFile(join(dir, 'err.mjs'), "process.stderr.write('SOLO_ERR'); process.exit(1);\n");
  await writeFile(join(dir, 'out.mjs'), "process.stdout.write('SOLO_OUT'); process.exit(1);\n");
  const both = await runVerify({ projectPath: dir, command: 'node both.mjs', timeoutMs: 20000 });
  assert.equal(both.ok, false);
  assert.equal(both.output, 'OUT\n\nERR');
  assert.equal((await runVerify({ projectPath: dir, command: 'node err.mjs', timeoutMs: 20000 })).output, 'SOLO_ERR');
  assert.equal((await runVerify({ projectPath: dir, command: 'node out.mjs', timeoutMs: 20000 })).output, 'SOLO_OUT');
});

const ioStub = (answers = []) => {
  const printed = []; const prompts = [];
  return {
    printed, prompts,
    print: (s) => printed.push(String(s)), startThinking() {}, stopThinking() {}, setTurn() {},
    choose: async (q) => { prompts.push(String(q)); return answers.shift() ?? 1; }
  };
};

async function gateProject(t2, command) {
  const dir = await tempDir(t2);
  await mkdir(join(dir, '.chalc'));
  await writeFile(join(dir, '.chalc', 'gate.json'), JSON.stringify({ verify: { command } }));
  return dir;
}

const reviewShell = (dir, result, allow = ['echo']) => ({
  model: 'm', tokens: { input: 0, output: 0, calls: 0 },
  session: { project: { projectPath: dir, stacks: [] }, allow, modelFor: () => 'm', review: async () => result }
});

test('R19: revisión OK → se avisa y se ofrece el portón de verificación', async (t2) => {
  const dir = await gateProject(t2, 'echo hola');
  const io = ioStub([1]);
  await runReviewTurn(reviewShell(dir, { ok: true }), io, 'tarea', ['a.js']);
  assert.ok(io.printed.some((l) => l.includes(t('cliReviewOk'))));
  assert.equal(io.prompts.length, 1);
  assert.ok(io.prompts[0].includes('echo hola'));
});

test('R19: revisión con hallazgos NO se da por buena: se muestran y se ofrece corregir', async (t2) => {
  const dir = await gateProject(t2, 'echo hola');
  const io = ioStub([1]);
  await runReviewTurn(reviewShell(dir, { ok: false, findings: 'HALLAZGO_UNO' }), io, 'tarea', ['a.js']);
  assert.ok(!io.printed.some((l) => l.includes(t('cliReviewOk'))));
  assert.ok(io.printed.some((l) => l.includes('HALLAZGO_UNO')));
  assert.ok(io.printed.some((l) => l.includes(t('cliFindingsNoted'))));
});

test('C7: la política del portón se evalúa con la raíz del PROYECTO, no con el cwd', async (t2) => {
  const dir = await tempDir(t2);
  const outside = await tempDir(t2);
  await mkdir(join(dir, '.chalc'));
  // Un enlace DENTRO del proyecto que apunta FUERA: solo se detecta resolviendo desde la raíz del proyecto.
  await symlink(outside, join(dir, 'fuga-chalc-mut'), 'junction');
  const cmd = 'ls fuga-chalc-mut';
  await writeFile(join(dir, '.chalc', 'gate.json'), JSON.stringify({ verify: { command: cmd } }));
  const io = ioStub([1]);
  await runVerifyTurn({ session: { project: { projectPath: dir, stacks: [] }, allow: ['ls'] } }, io);
  assert.equal(io.prompts.length, 0, 'fuera del proyecto: no se ofrece correrlo');
  assert.ok(io.printed.some((l) => l.includes(t('cliVerifyNotAllowed', cmd))));
});

test('F7: un fallo inesperado se informa aunque el io no tenga stopThinking', async () => {
  const boom = { get project() { throw new Error('boom-sin-spinner'); } };
  const printed = [];
  await assert.doesNotReject(runVerifyTurn({ session: boom }, { print: (s) => printed.push(String(s)) }));
  assert.ok(printed.some((l) => l.includes('boom-sin-spinner')));
});
