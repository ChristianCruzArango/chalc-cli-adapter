// M-04 — las opciones de la línea de comandos son de solo lectura. `deliver` las cambiaba para su
// etapa de QA escribiendo en el `flags` que comparten todos los módulos y restaurándolo después;
// ahora se las pasa a `runQa`, y el objeto está congelado para que nadie vuelva a escribirlo.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { flags } from '../lib/commands/context.mjs';

test('the parsed command-line flags cannot be modified', () => {
  assert.equal(Object.isFrozen(flags), true);
  assert.throws(() => { flags.agent = true; }, TypeError);
});

test('deliver passes its QA options to runQa instead of patching the shared flags', async () => {
  const src = await readFile(new URL('../lib/commands/deliver.mjs', import.meta.url), 'utf8');
  assert.match(src, /runQa\(\{ flags: \{ \.\.\.flags, \.\.\.deliverQaFlagPatch\(\) \} \}\)/);
  assert.doesNotMatch(src, /withTemporaryFlags/);
});
