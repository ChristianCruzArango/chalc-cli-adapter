// F-03 — la verificación se puede declarar por proyecto y una omisión queda escrita como omisión.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyCommand } from '../cli/engine/verify.mjs';
import { readFileSync } from 'node:fs';
import { logVerify, reviewPath } from '../cli/engine/reviewfile.mjs';

test('a project can declare its own verification command in gate.json', async () => {
  const root = await mkdtemp(join(tmpdir(), 'chalc-f03-'));
  assert.equal(verifyCommand(['javascript'], { projectPath: root }), null);
  await mkdir(join(root, '.chalc'), { recursive: true });
  await writeFile(join(root, '.chalc', 'gate.json'), JSON.stringify({ verify: { command: 'npm run typecheck' } }));
  assert.equal(verifyCommand(['javascript'], { projectPath: root }), 'npm run typecheck');
  assert.equal(verifyCommand(['dotnet'], { projectPath: root }), 'npm run typecheck', 'lo declarado gana sobre el stack');
});

test('a skipped verification is logged as skipped, never as OK', async () => {
  const root = await mkdtemp(join(tmpdir(), 'chalc-f03-log-'));
  await mkdir(join(root, '.chalc'), { recursive: true });
  await writeFile(join(root, '.chalc', 'review.md'), '# Revisión\n\n');   // la abre la revisión, siempre antes
  logVerify(root, 0, { skipped: true, reason: 'sin comando de verificación' });
  const text = readFileSync(reviewPath(root), 'utf8');
  assert.match(text, /OMITIDA \(sin comando de verificación\)/);
  assert.doesNotMatch(text, /OK ✔/);
});
