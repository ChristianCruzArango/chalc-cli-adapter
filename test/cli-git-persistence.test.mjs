// S-05 — /auto no puede dejar ejecución diferida que sobreviva a la sesión.
//
// Tres vías reproducidas: escribir config de git que ejecuta comandos (core.fsmonitor, alias !cmd),
// crear un hook en `.git/hooks/`, y flags de evaluación escritos de otra forma (`--require=`, `-pe`).

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createShellTool } from '../cli/tools/shell.mjs';
import { createFsTools } from '../cli/tools/fs.mjs';
import { requiresExplicitApproval } from '../cli/tools/trust.mjs';

const root = await mkdtemp(join(tmpdir(), 'chalc-s05-'));
const { bash } = createShellTool({ root, allow: ['git', 'node', 'python', 'python3'], approve: async () => false });

test('git config writes are blocked before approval', async () => {
  for (const cmd of ['git config core.fsmonitor "touch PWNED"', 'git config alias.x "!touch PWNED"', 'git config --global core.hooksPath h', 'git -C . config core.pager x', 'git config set core.editor x']) {
    assert.match((await bash.run({ command: cmd })).error, /git config writes are not allowed/, cmd);
  }
});

test('reading git config is still allowed (reaches the approval step)', async () => {
  for (const cmd of ['git config --get user.name', 'git config --list', 'git config -l', 'git config get user.name', 'git log -- config']) {
    assert.match((await bash.run({ command: cmd })).error, /not approved/, cmd);
  }
});

test('git subcommands that run arbitrary commands always need explicit approval', () => {
  for (const cmd of ['git submodule foreach "touch x"', 'git bisect run make', 'git rebase --exec "make" main', 'git rebase -x make main', 'git filter-branch --tree-filter x']) {
    assert.equal(requiresExplicitApproval({ tool: 'bash', args: { command: cmd } }), true, cmd);
  }
  // Desde R7 (spec 016) /auto solo deja pasar los git de lectura: `rebase` también pregunta.
  assert.equal(requiresExplicitApproval({ tool: 'bash', args: { command: 'git rebase main' } }), true);
  assert.equal(requiresExplicitApproval({ tool: 'bash', args: { command: 'git status' } }), false);
});

test('inline-eval flags are caught in every spelling the binaries accept', async () => {
  const cases = [
    ['node --require=./x.js app.js', '--require'],
    ['node --import=./x.mjs app.js', '--import'],
    ['node -r./x.js app.js', '-r'],
    ['node -pe 1', '-p'],
    ['python -Bc "print(1)"', '-c'],
    ['python3 -c"print(1)"', '-c'],
    ['git --config-env=core.pager=X log', '--config-env']
  ];
  for (const [cmd, flag] of cases) {
    assert.match((await bash.run({ command: cmd })).error, new RegExp(`flag not allowed for \\w+: ${flag}`), cmd);
  }
});

test('flags with an attached value are not mistaken for eval flags', async () => {
  for (const cmd of ['python -Wdefault script.py', 'python -m pytest', 'node --version']) {
    assert.match((await bash.run({ command: cmd })).error, /not approved/, cmd);
  }
});

test('write and edit refuse paths inside .git/, including via an inner symlink', async () => {
  await mkdir(join(root, '.git', 'hooks'), { recursive: true });
  const { write, edit } = createFsTools({ root });
  await assert.rejects(() => write.run({ path: '.git/hooks/pre-commit', content: '#!/bin/sh\ntouch PWNED' }), /inside \.git/);
  await assert.rejects(() => write.run({ path: 'sub/../.GIT/config', content: 'x' }), /inside \.git/);
  await assert.rejects(() => edit.run({ path: '.git/config', old: 'a', new: 'b' }), /inside \.git/);
  if (process.platform !== 'win32') {
    await symlink(join(root, '.git', 'hooks'), join(root, 'hooks'));
    await assert.rejects(() => write.run({ path: 'hooks/post-checkout', content: 'x' }), /inside \.git/);
  }
  assert.equal(existsSync(join(root, '.git', 'hooks', 'pre-commit')), false);
  assert.equal((await write.run({ path: '.github/workflows/ci.yml', content: 'on: push' })).ok, true);
  assert.equal((await write.run({ path: '.gitignore', content: 'x' })).ok, true);
});
