// V-02 (spec 016, R2) — la verificación ejecuta EXACTAMENTE el comando aprobado. Si `.chalc/gate.json`
// cambia entre la aprobación y la ejecución, o durante la ronda de corrección, el nuevo comando se
// revalida contra la allowlist y se vuelve a pedir aprobación.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runVerifyTurn } from '../cli/shell/quality.mjs';
import { runVerify } from '../cli/engine/verify.mjs';

const PAYLOAD = "import { writeFileSync } from 'node:fs'; writeFileSync('marker.txt', 'x');\n";

async function project(command) {
  const root = await mkdtemp(join(tmpdir(), 'chalc-v02-'));
  await mkdir(join(root, '.chalc'));
  await writeFile(join(root, '.chalc', 'gate.json'), JSON.stringify({ verify: { command } }));
  await writeFile(join(root, 'payload.mjs'), PAYLOAD);
  await writeFile(join(root, 'fail.mjs'), 'process.exit(1);\n');
  return root;
}
const setCommand = (root, command) => writeFile(join(root, '.chalc', 'gate.json'), JSON.stringify({ verify: { command } }));

function harness(root, allow, answers, { onChoose = async () => {}, onAsk = async () => {} } = {}) {
  const prompts = [];
  const io = {
    print: () => {}, startThinking: () => {}, stopThinking: () => {},
    choose: async (prompt) => { prompts.push(String(prompt)); await onChoose(prompts.length); return answers.shift() ?? 1; }
  };
  const session = { project: { projectPath: root, stacks: [] }, allow, ask: async () => { await onAsk(); return { ok: true }; } };
  const shell = { session, approval: { auto: false }, policy: {}, tokens: { input: 0, output: 0, calls: 0 } };
  return { shell, io, prompts };
}

test('R2: a gate.json change while approval is pending does not run the new command', async () => {
  const root = await project('echo APPROVED_BENIGN');
  const h = harness(root, ['echo'], [0], { onChoose: () => setCommand(root, 'node payload.mjs') });
  await runVerifyTurn(h.shell, h.io);
  assert.equal(existsSync(join(root, 'marker.txt')), false);
  assert.equal(h.prompts.length, 1);
  assert.match(h.prompts[0], /echo APPROVED_BENIGN/);
});

test('R2: a command changed during the fix round needs a new approval (declined → not run)', async () => {
  const root = await project('node fail.mjs');
  const h = harness(root, ['node'], [0, 0, 1], { onAsk: () => setCommand(root, 'node payload.mjs') });
  await runVerifyTurn(h.shell, h.io);
  assert.equal(existsSync(join(root, 'marker.txt')), false);
  assert.equal(h.prompts.length, 3);
  assert.match(h.prompts[2], /node payload\.mjs/);
});

test('R2: a command changed during the fix round runs only after it is approved again', async () => {
  const root = await project('node fail.mjs');
  const h = harness(root, ['node'], [0, 0, 0], { onAsk: () => setCommand(root, 'node payload.mjs') });
  await runVerifyTurn(h.shell, h.io);
  assert.equal(existsSync(join(root, 'marker.txt')), true);
  assert.equal(h.prompts.length, 3);
});

test('R2: a command changed during the fix round outside the allowlist is never run nor asked', async () => {
  const root = await project('node fail.mjs');
  const h = harness(root, ['node'], [0, 0, 0], { onAsk: () => setCommand(root, 'sh -c "touch marker.txt"') });
  await runVerifyTurn(h.shell, h.io);
  assert.equal(existsSync(join(root, 'marker.txt')), false);
  assert.equal(h.prompts.length, 2);
});

test('R2: an unchanged command keeps the approval for the second round', async () => {
  const root = await project('node fail.mjs');
  const h = harness(root, ['node'], [0, 0]);
  await runVerifyTurn(h.shell, h.io);
  assert.equal(h.prompts.length, 2);
});

test('R2: runVerify runs the given command snapshot without re-reading gate.json', async () => {
  const root = await project('node payload.mjs');
  const r = await runVerify({ projectPath: root, stacks: [], command: 'node fail.mjs' });
  assert.equal(r.command, 'node fail.mjs');
  assert.equal(r.ok, false);
  assert.equal(existsSync(join(root, 'marker.txt')), false);
});
