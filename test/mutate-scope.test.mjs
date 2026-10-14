// T8 (spec 022, R21, 5.5) — el alcance de Stryker se calcula desde `git diff -U0 <base>`, no de una lista
// literal que se congela: líneas nuevas por tramo en bin/ cli/ lib/ targets/ catalog/, archivos nuevos enteros,
// y fuera los diccionarios i18n y los entrypoints que solo se prueban por subproceso.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mutateScope, mutateBase, isMutable } from './helpers/mutatescope.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const DIFF = [
  'diff --git a/lib/a.mjs b/lib/a.mjs', '--- a/lib/a.mjs', '+++ b/lib/a.mjs',
  '@@ -3,0 +4,2 @@', '+x', '+y', '@@ -9 +11 @@', '-old', '+new',
  '@@ -20,2 +22,0 @@', '-gone', '-gone',
  '--- a/lib/i18n/es/core.mjs', '+++ b/lib/i18n/es/core.mjs', '@@ -1 +1 @@', '-a', '+b',
  '--- a/bin/chalc.mjs', '+++ b/bin/chalc.mjs', '@@ -1 +1 @@', '-a', '+b',
  '--- a/README.md', '+++ b/README.md', '@@ -1 +1 @@', '-a', '+b',
  '--- a/test/x.test.mjs', '+++ b/test/x.test.mjs', '@@ -1 +1 @@', '-a', '+b',
  '--- a/targets/codex.mjs', '+++ /dev/null', '@@ -1,3 +0,0 @@', '-a', '-b', '-c'
].join('\n');

test('5.5: cada tramo nuevo es un `archivo:desde-hasta`; los bloques que solo borran no entran', () => {
  assert.deepEqual(mutateScope({ diff: DIFF }), ['lib/a.mjs:4-5', 'lib/a.mjs:11-11']);
});

test('5.5: los archivos nuevos (sin seguimiento) entran enteros, con el mismo filtro', () => {
  const untracked = ['lib/markup2.mjs', 'cli/index.mjs', 'lib/i18n/en/x.mjs', 'test/y.test.mjs', 'catalog/live/lib/z.mjs', 'lib/notes.md'];
  assert.deepEqual(mutateScope({ diff: '', untracked }), ['catalog/live/lib/z.mjs', 'lib/markup2.mjs']);
});

test('5.5: qué se puede mutar', () => {
  for (const p of ['bin/x.mjs', 'cli/a/b.mjs', 'lib/i18n.mjs', 'targets/codex.mjs', 'catalog/gate/gate.mjs']) assert.equal(isMutable(p), true, p);
  for (const p of ['lib/i18n/es/core.mjs', 'bin/chalc.mjs', 'cli/index.mjs', 'test/a.test.mjs', 'stryker.config.mjs', 'lib/x.json']) assert.equal(isMutable(p), false, p);
});

test('5.5: la base sale de CHALC_MUTATE_BASE y, sin ella, de git', () => {
  assert.equal(mutateBase({ CHALC_MUTATE_BASE: 'abc123' }, ROOT), 'abc123');
  const base = mutateBase({}, ROOT);
  assert.ok(base, 'hay una base');
  assert.doesNotThrow(() => execFileSync('git', ['rev-parse', '--verify', `${base}^{commit}`], { cwd: ROOT, stdio: 'ignore' }));
});
