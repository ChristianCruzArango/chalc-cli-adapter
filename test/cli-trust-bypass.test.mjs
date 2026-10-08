// S-01 — la aprobación obligatoria de /auto no se salta con comillas ni con opciones delante.
//
// La auditoría lo reprodujo: `"node" x.mjs` y `npm -s run x` se clasificaban como inocuos y luego
// la shell los ejecutaba sin preguntar. Aprobación y ejecución leen ahora los mismos tokens.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isEvalCapableCommand, requiresExplicitApproval, DEV_ALLOW } from '../cli/tools/trust.mjs';
import { createShellTool } from '../cli/tools/shell.mjs';

const BYPASSES = [
  'node harmless.mjs',
  '"node" harmless.mjs',
  "'node' harmless.mjs",
  'npm "run" build',
  'npm -s run x',
  'npm --silent exec harmless',
  'npm --prefix=. run build',
  'npm --prefix . run build',
  'npm run-script build',
  'npm init vite',
  'pnpm --filter web exec x',
  './node x.mjs',
  'NODE.EXE x.mjs',
  'npm "unterminated'
];

test('every reproduced bypass now requires explicit approval', () => {
  for (const cmd of BYPASSES) {
    assert.equal(requiresExplicitApproval({ tool: 'bash', args: { command: cmd } }), true, cmd);
  }
});

test('project build and test commands stay under /auto', () => {
  for (const cmd of ['npm test', 'npm install', 'npm ci --silent', 'dotnet build', 'git status', 'ls src']) {
    assert.equal(isEvalCapableCommand(cmd), false, cmd);
  }
});

// Integración: con /auto, el approve de la CLI solo pregunta cuando la clasificación lo exige. Se
// cuenta cuántas confirmaciones pidió y qué ejecutó la shell para el mismo texto.
test('with /auto on, a quoted interpreter is executed only after an explicit confirmation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'chalc-s01-'));
  await writeFile(join(root, 'harmless.mjs'), "console.log('ran')");
  let confirmations = 0;
  const approve = async (action) => {
    if (!requiresExplicitApproval(action)) return true;   // /auto activo
    confirmations++;
    return false;                                           // el humano dice que no
  };
  const { bash } = createShellTool({ root, allow: DEV_ALLOW, approve });

  const r = await bash.run({ command: '"node" harmless.mjs' });

  assert.equal(confirmations, 1);
  assert.equal(r.error, 'action not approved by the user');
  assert.equal(r.stdout, undefined);
});
