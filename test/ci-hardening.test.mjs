// S-31 — el CI corre con el mínimo privilegio y con acciones fijadas por SHA.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const CI = fileURLToPath(new URL('../.github/workflows/ci.yml', import.meta.url));

test('the workflow declares read-only permissions', async () => {
  // En Windows el checkout convierte a CRLF (core.autocrlf): se normaliza antes de comparar.
  assert.match((await readFile(CI, 'utf8')).replace(/\r\n/g, '\n'), /^permissions:\n\s+contents: read$/m);
});

test('every action is pinned to a full commit SHA and checkout does not keep the token', async () => {
  const text = await readFile(CI, 'utf8');
  const uses = [...text.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
  assert.ok(uses.length);
  for (const ref of uses) assert.match(ref, /@[0-9a-f]{40}$/, ref);
  assert.equal((text.match(/persist-credentials: false/g) || []).length, (text.match(/actions\/checkout@/g) || []).length);
});
