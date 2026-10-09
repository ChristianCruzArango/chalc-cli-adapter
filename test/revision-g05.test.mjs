// G-05 (spec 016, R14) — claves de gate.json que vacían o desvían etapas quedan vigiladas (spec.dir,
// mutation.scopeFlag/probe/scopeJoin) y un `threshold` que no es un número en [0,100] bloquea en vez
// de aceptarse (-1) o caer a 80 en silencio (string).

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { guardedConfig, configChanges } from '../catalog/gate/lib/fingerprint.mjs';
import { loadConfig } from '../catalog/gate/lib/config.mjs';
import { runGate } from '../catalog/gate/gate.mjs';

test('R14: spec.dir and mutation.scopeFlag/probe/scopeJoin are guarded', () => {
  const base = { spec: { dir: 'specs' }, mutation: { scopeFlag: '--mutate', probe: 'x', scopeJoin: ',' } };
  const sealed = guardedConfig(base);
  for (const [key, change] of [
    ['spec.dir', { spec: { dir: 'nada' } }],
    ['mutation.scopeFlag', { mutation: { ...base.mutation, scopeFlag: '' } }],
    ['mutation.probe', { mutation: { ...base.mutation, probe: '' } }],
    ['mutation.scopeJoin', { mutation: { ...base.mutation, scopeJoin: ' ' } }]
  ]) {
    assert.deepEqual(configChanges(sealed, { ...base, ...change }), [key], key);
  }
});

test('R14: a baseline sealed before these keys existed reports no false change', () => {
  const oldSeal = { 'test.command': 'npm test' };
  assert.deepEqual(configChanges(oldSeal, { test: { command: 'npm test' }, spec: { dir: 'otra' } }), []);
});

async function repoWith(threshold) {
  const root = await mkdtemp(join(tmpdir(), 'chalc-g05-'));
  await mkdir(join(root, '.chalc'));
  await writeFile(join(root, '.chalc', 'gate.json'), JSON.stringify({ language: 'es', mutation: { threshold } }));
  return root;
}

test('R14: a threshold outside [0,100] or not a number is a config error', async () => {
  for (const bad of [-1, 101, '80', null, Number.NaN, true]) {
    const { error } = await loadConfig(await repoWith(bad));
    assert.match(error, /threshold/, String(bad));
  }
});

test('R14: valid thresholds, including the edges, load without error', async () => {
  for (const ok of [0, 80, 100, 92.5]) {
    const { error, config } = await loadConfig(await repoWith(ok));
    assert.equal(error, '', String(ok));
    assert.equal(config.mutation.threshold, ok);
  }
});

test('R14: the gate blocks with an invalid threshold, and the message is translated', async () => {
  const root = await repoWith(-1);
  const result = await runGate({ root, run: async () => ({ code: 0, ms: 1 }), fast: true, changed: [] });
  assert.equal(result.verdict, 'blocked');
  const en = await mkdtemp(join(tmpdir(), 'chalc-g05-en-'));
  await mkdir(join(en, '.chalc'));
  await writeFile(join(en, '.chalc', 'gate.json'), JSON.stringify({ language: 'en', mutation: { threshold: -1 } }));
  const [es, eng] = [(await loadConfig(root)).error, (await loadConfig(en)).error];
  assert.notEqual(es, eng);
});
