// T37 (spec 016, R37) — el contexto de la CLI se calcula con una función PURA, `createContext(argv)`:
// se puede probar y reutilizar sin depender de `process.argv` ni escribir nada. El módulo sigue
// exponiendo el resultado para `process.argv` (caracterización de 249 casos en revision-m04).

import test from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { createContext } from '../lib/commands/context.mjs';

test('R37: two contexts from different argv are independent and do not read process.argv', () => {
  const a = createContext(['qa', 'demo', '--dry-run'], { cwd: '/base', isTTY: true });
  const b = createContext(['debate', 'una', 'idea', '--yes'], { cwd: '/base', isTTY: true });
  assert.deepEqual([a.verb, a.projectArg, a.projectPath, a.dryRun, a.interactive], ['qa', 'demo', resolve('/base', 'demo'), true, true]);
  assert.deepEqual([b.verb, b.projectArg, b.projectPath, b.assumeYes, b.interactive], ['debate', null, resolve('/base'), true, false]);
});

test('R37: cwd and TTY are explicit inputs', () => {
  assert.equal(createContext([], { cwd: '/otra/raiz', isTTY: false }).projectPath, resolve('/otra/raiz'));
  assert.equal(createContext([], { cwd: '/x', isTTY: false }).interactive, false);
  assert.equal(createContext([], { cwd: '/x', isTTY: true }).interactive, true);
});

test('R37: a bad flag is returned as argError (nothing thrown, nothing written); secret flags come back as warnings', () => {
  const original = process.stderr.write;
  const written = [];
  process.stderr.write = (chunk) => { written.push(String(chunk)); return true; };
  try {
    const bad = createContext(['--no-such-flag'], { cwd: '/x', isTTY: false });
    assert.match(bad.argError.message, /no-such-flag/);
    const secret = createContext(['qa', '--token', 'abc'], { cwd: '/x', isTTY: false });
    assert.deepEqual(secret.warnings.map((w) => w.flag), ['token']);
  } finally { process.stderr.write = original; }
  assert.deepEqual(written, []);
  assert.ok(Object.isFrozen(createContext([], { cwd: '/x' }).flags));
});

test('R37: spec project detection and method flags are part of the context', () => {
  const ctx = createContext(['spec', 'nueva-feature', './proyecto', '--method', 'sdd', '--method', 'bdd'], { cwd: '/x', isTTY: false });
  assert.equal(ctx.specProjectArg, './proyecto');
  assert.deepEqual(ctx.specArgs, ['nueva-feature', './proyecto']);
  assert.deepEqual(ctx.methodFlags, ['sdd', 'bdd']);
  assert.equal(ctx.projectPath, join(resolve('/x'), 'proyecto'));
});

test('R37: install keeps its source and its project in their positions', () => {
  const ctx = createContext(['install', 'https://github.com/x/skill', 'mi-proyecto'], { cwd: '/x', isTTY: false });
  assert.deepEqual([ctx.verb, ctx.installSource, ctx.projectArg], ['install', 'https://github.com/x/skill', 'mi-proyecto']);
  assert.equal(createContext(['qa', 'p'], { cwd: '/x' }).installSource, null);
});
