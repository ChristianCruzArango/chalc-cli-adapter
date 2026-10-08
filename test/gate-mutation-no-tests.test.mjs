// La mutación muta el código de la tarea, nunca sus tests.
//
// Encontrado en la prueba de punta a punta de la spec 014: el alcance de la mutación eran todos los
// archivos fuente de la tarea, y los tests también lo son. Stryker mutaba `test/cobro.test.mjs`, y un
// test mutado no lo mata nadie —el test ES lo que mata mutantes—, así que cada tarea con tests nuevos
// arrastraba supervivientes imposibles y el score bajaba sin que el código tuviera la culpa.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { runMutation } from '../catalog/gate/lib/mutation.mjs';

const REPORT = 'reports/mutation/mutation.json';
const KILLED = JSON.stringify({
  schemaVersion: '1.0',
  files: { 'src/cobro.mjs': { mutants: [{ id: '1', mutatorName: 'BooleanLiteral', status: 'Killed', location: { start: { line: 1, column: 1 } } }] } }
});

test('the tests of the task are left out of the mutation scope, in every naming convention', async () => {
  const root = await mkdtemp(join(tmpdir(), 'chalc-mut-tests-'));
  const commands = [];
  const run = async (command) => {
    commands.push(command);
    await mkdir(dirname(join(root, REPORT)), { recursive: true });
    await writeFile(join(root, REPORT), KILLED);
    return { code: 0, ms: 1 };
  };
  const config = { mutation: { tool: 'stryker', command: 'npx stryker run', report: REPORT, format: 'elements', threshold: 80, scopeFlag: '--mutate' } };

  await runMutation(config, {
    root, run,
    changed: ['src/cobro.mjs', 'test/cobro.test.mjs', 'src/precio.spec.ts', 'test/pago_test.dart', 'tests/test_pago.py']
  });

  assert.equal(commands[0], 'npx stryker run --mutate src/cobro.mjs');
});
