// T2 (spec 022, R17, S9 verify) — la salida del portón de verificación se redacta antes de volver al
// orquestador, de viajar como `task` al proveedor y de persistirse en `.chalc/review.md`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runVerify } from '../cli/engine/verify.mjs';
import { runVerifyTurn } from '../cli/shell/quality.mjs';
import { logVerify, logFixOrder, reviewPath } from '../cli/engine/reviewfile.mjs';

const KEY = 'sk-proj-ABCDEFGHIJKLMNOPQRSTUV123456';
const LEAK = `console.error('DB_PASSWORD=hunter2secret ${KEY}'); process.exit(1);\n`;

async function project() {
  const root = await mkdtemp(join(tmpdir(), 'chalc-022-g2-verify-'));
  await mkdir(join(root, '.chalc'));
  await writeFile(join(root, 'leak.mjs'), LEAK);
  await writeFile(join(root, '.chalc', 'review.md'), '# Revisión\n\n');
  return root;
}

test('T2 (spec 022, R17, S9 verify): runVerify redacts sensitive values in the failing output', async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  const v = await runVerify({ projectPath: root, command: 'node leak.mjs' });
  assert.equal(v.ok, false);
  assert.doesNotMatch(v.output, /hunter2secret/);
  assert.ok(!v.output.includes(KEY));
  assert.match(v.output, /REDACTED/);
});

test('T2 (spec 022, R17, S9 verify): the fix order sent to the provider carries no secret', async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, '.chalc', 'gate.json'), JSON.stringify({ verify: { command: 'node leak.mjs' } }));
  const orders = [];
  const io = { print: () => {}, startThinking: () => {}, stopThinking: () => {}, choose: async () => 0 };
  const session = { project: { projectPath: root, stacks: [] }, allow: ['node'], ask: async (task) => { orders.push(String(task)); return { ok: true }; } };
  const shell = { session, approval: { auto: false }, policy: {}, tokens: { input: 0, output: 0, calls: 0 } };
  await runVerifyTurn(shell, io);
  assert.ok(orders.length >= 1);
  for (const order of orders) assert.ok(!order.includes(KEY) && !order.includes('hunter2secret'));
});

test('T2 (spec 022, R17, S9 reviewfile): review.md never persists a secret from the gate output or the order', async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  logVerify(root, 1, { ok: false, command: 'npm test', output: `boom ${KEY}\npassword=hunter2secret` });
  logFixOrder(root, `fix this: ${KEY}`);
  const text = readFileSync(reviewPath(root), 'utf8');
  assert.ok(!text.includes(KEY));
  assert.doesNotMatch(text, /hunter2secret/);
});
