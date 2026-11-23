// Spec 028 (puertas humanas), T4 — las aprobaciones no son un interruptor (R9): `flow.approvals` deja de
// escribirse y se retira de un `gate.json` que lo tuviera, sin tocar el resto de lo que el usuario editó.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { detectGateConfig } from '../lib/gatedetect.mjs';
import { emitGate } from '../lib/gateemit.mjs';
import { loadConfig } from '../catalog/gate/lib/config.mjs';

async function project(t, gateJson) {
  const dir = await tempDir(t, 'chalc-028-switch-');
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts: { test: 'jest' }, devDependencies: { jest: '^29.0.0' } }));
  if (gateJson) {
    await mkdir(join(dir, '.chalc'), { recursive: true });
    await writeFile(join(dir, '.chalc', 'gate.json'), JSON.stringify(gateJson));
  }
  return dir;
}
const gateJson = async (dir) => JSON.parse(await readFile(join(dir, '.chalc', 'gate.json'), 'utf8'));

test('R9: la config detectada ya no lleva flow.approvals', async (t) => {
  const flow = (await detectGateConfig(await project(t))).flow;
  assert.equal('approvals' in flow, false);
  assert.deepEqual(flow.review, { required: true });
  assert.ok(flow.roles.length > 0);
});

test('R9: tampoco los valores por defecto del portón', async (t) => {
  const { config } = await loadConfig(await project(t, { test: { command: 'npm test' } }));
  assert.equal('approvals' in config.flow, false);
  assert.deepEqual(config.flow.review, { required: true });
});

test('R9: equipar un repo nuevo escribe gate.json sin flow.approvals', async (t) => {
  const dir = await project(t);
  await emitGate(dir, { language: 'es' });
  assert.equal('approvals' in (await gateJson(dir)).flow, false);
});

test('R9: re-equipar retira flow.approvals y conserva lo demás que editó el usuario', async (t) => {
  const mine = {
    mutation: { threshold: 90 },
    lint: { maxFileLines: 250 },
    flow: { approvals: { task: false, feature: false }, review: { required: false } }
  };
  const dir = await project(t, mine);
  await emitGate(dir, { language: 'es' });
  const merged = await gateJson(dir);
  assert.equal('approvals' in merged.flow, false);
  assert.deepEqual(merged.flow.review, { required: false });
  assert.equal(merged.mutation.threshold, 90);
  assert.equal(merged.lint.maxFileLines, 250);
  assert.ok(merged.flow.roles.length > 0);
});

test('R9: un gate.json antiguo con flow.approvals se sigue leyendo sin error', async (t) => {
  const { config, error } = await loadConfig(await project(t, { test: { command: 'npm test' }, flow: { approvals: { task: false } } }));
  assert.ok(!error, String(error));
  assert.equal(config.test.command, 'npm test');
});
