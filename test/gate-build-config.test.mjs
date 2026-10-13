// T6 (spec 018, R4) — `build.command` es una clave que decide si una tarea cierra.
//
// Vaciar el comando de compilación apaga la etapa en silencio (queda «no aplica»), igual que poner
// `test.command: "true"` aprobaría sin medir. No está prohibido —el usuario ajusta su portón—, pero la
// evidencia tiene que decirlo (huella de la spec 016).

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { configChanges, guardedConfig } from '../catalog/gate/lib/fingerprint.mjs';
import { loadConfig } from '../catalog/gate/lib/config.mjs';

test('R4 (018): build.command is sealed with the task and its change is reported', () => {
  const sealed = guardedConfig({ build: { command: 'npm run build' } });
  assert.equal(sealed['build.command'], 'npm run build');
  assert.deepEqual(configChanges(sealed, { build: { command: '' } }), ['build.command']);
  assert.deepEqual(configChanges(sealed, { build: { command: 'npm run build' } }), []);
});

test('R4 (018): a gate.json without build reads as an empty build command', async () => {
  const root = await mkdtemp(join(tmpdir(), 'chalc-build-config-'));
  await mkdir(join(root, '.chalc'), { recursive: true });
  await writeFile(join(root, '.chalc', 'gate.json'), JSON.stringify({ test: { command: 'npm test' } }));
  const { config } = await loadConfig(root);
  assert.deepEqual(config.build, { command: '' });
});
