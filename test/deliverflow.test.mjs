import test from 'node:test';
import assert from 'node:assert/strict';
import { actionableVerdicts, buildDeliverRerunCommand, deliverQaFlagPatch } from '../lib/deliverflow.mjs';

test('deliverQaFlagPatch fuerza QA agent con repair-plan y omite inputs opcionales', () => {
  assert.deepEqual(deliverQaFlagPatch(), {
    plan: true,
    up: true,
    agent: true,
    'repair-plan': true,
    'skip-qa-inputs': true
  });
});

test('actionableVerdicts devuelve solo FAIL y BLOCKED', () => {
  const out = actionableVerdicts({
    verdicts: [
      { id: 'R1', status: 'PASS' },
      { id: 'R2', status: 'fail' },
      { id: 'R3', status: 'BLOCKED' },
      { id: 'R4', status: 'NOT_APPLICABLE' }
    ]
  });
  assert.deepEqual(out.map((v) => v.id), ['R2', 'R3']);
});

test('buildDeliverRerunCommand conserva spec/env/url/surface y quotea rutas con espacios', () => {
  const cmd = buildDeliverRerunCommand({
    projectPath: '/tmp/mi app',
    specId: '001-login',
    env: 'npm:start',
    url: 'http://localhost:3000',
    surface: 'web',
    allowExec: true
  });

  assert.equal(cmd, 'chalc deliver "/tmp/mi app" --spec 001-login --env npm:start --url http://localhost:3000 --surface web --rerun --allow-exec');
});
