// S-18 — el portón de verificación se rige por el perfil de confianza y nunca descarga `ng` de npm.

import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyAllowed, verifyCommand } from '../cli/engine/verify.mjs';
import { resolveShellPolicy } from '../cli/tools/trust.mjs';

test('the Angular check never installs from npm', () => {
  assert.match(verifyCommand(['angular']), /^npx --no-install ng build/);
});

test('the safe profile does not run builds; dev does', () => {
  const cmd = verifyCommand(['dotnet']);
  assert.equal(verifyAllowed(cmd, resolveShellPolicy({ trust: 'safe' }).allow), false);
  assert.equal(verifyAllowed(cmd, resolveShellPolicy({ trust: 'dev' }).allow), true);
  assert.equal(verifyAllowed(verifyCommand(['angular']), ['dotnet']), false);
});
