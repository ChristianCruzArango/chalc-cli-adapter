// V-05 (spec 016, R4) — la shell del agente no escribe en `.git/` ni fuera del proyecto: los valores de
// opción se confinan exista o no el destino, `.git/` se protege también en la shell, git no acepta
// opciones que escriben archivos o cambian lo que ejecuta, y los subcomandos que disparan hooks piden
// aprobación explícita aunque /auto esté activo.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkCommand } from '../cli/tools/shellpolicy.mjs';
import { requiresExplicitApproval } from '../cli/tools/trust.mjs';

const ALLOW = ['git', 'mkdir', 'cat', 'ng', 'touch', 'cp'];

async function repo() {
  const base = await mkdtemp(join(tmpdir(), 'chalc-v05-'));
  const root = join(base, 'repo');
  await mkdir(join(root, '.git'), { recursive: true });
  await writeFile(join(root, '.git', 'config'), '[core]\n');
  await mkdir(join(root, 'src'));
  await mkdir(join(base, 'existing-outside'));
  return { base, root, cleanup: () => rm(base, { recursive: true, force: true }) };
}

const rejected = (root, cmd) => assert.ok(checkCommand(cmd, { root, allow: ALLOW }).error, `se esperaba rechazo: ${cmd}`);
const accepted = (root, cmd) => assert.equal(checkCommand(cmd, { root, allow: ALLOW }).error, undefined, `se esperaba aceptado: ${cmd}`);
const explicit = (cmd) => requiresExplicitApproval({ tool: 'bash', args: { command: cmd } });

test('R4: the three commands from the report are rejected', async () => {
  const { root, base, cleanup } = await repo();
  try {
    rejected(root, 'git log -1 --format=%B --output=.git/config');
    rejected(root, `git log -1 --format=%B --output=${join(base, 'existing-outside', 'new-dir', 'x.plist')}`);
    rejected(root, `mkdir --parents ${join(base, 'existing-outside', 'new', 'a')}`);
  } finally { await cleanup(); }
});

test('R4: absolute option values under an existing directory outside the project are rejected (= or space)', async () => {
  const { root, base, cleanup } = await repo();
  try {
    rejected(root, `touch --reference=${join(base, 'existing-outside', 'nope')}`);
    rejected(root, `cp --target-directory ${join(base, 'existing-outside', 'new')} src`);
  } finally { await cleanup(); }
});

test('R4: data-like absolute values and in-project paths stay allowed', async () => {
  const { root, cleanup } = await repo();
  try {
    accepted(root, 'ng build --base-href /app/');
    accepted(root, 'ng build --base-href=/app/');
    accepted(root, 'ng build --deploy-url /chalc-no-such-dir/static/');
    accepted(root, 'mkdir --parents src/new/deep');
    accepted(root, 'git log -1 --format=%B');
    accepted(root, 'cat .gitignore');
    accepted(root, 'cat .github/workflows/ci.yml');
    accepted(root, 'git ls-files -o --exclude-standard');
    accepted(root, 'git log --oneline');
    accepted(root, 'git checkout -- src');
    accepted(root, 'ng build --output dist');
    accepted(root, 'cat https://example.com/a/b');
  } finally { await cleanup(); }
});

test('R4: .git/ paths are rejected even before the project has a .git folder', async () => {
  const base = await mkdtemp(join(tmpdir(), 'chalc-v05-nogit-'));
  try {
    rejected(base, 'mkdir --parents .git/hooks');
    rejected(base, 'touch .git/config');
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('R4: a dangling link inside the project is treated as outside (its target is unknown)', async () => {
  const { root, cleanup } = await repo();
  try {
    await symlink('/chalc-no-such-dir/target', join(root, 'dangle'));
    rejected(root, 'cp src dangle');
  } finally { await cleanup(); }
});

test('R4: any argument pointing inside .git/ is rejected, lexically or through an internal link', async () => {
  const { root, cleanup } = await repo();
  try {
    rejected(root, 'cp src .git/hooks/pre-commit');
    rejected(root, 'touch .git/config');
    rejected(root, 'touch src/../.git/config');
    rejected(root, 'touch .GIT/config');
    rejected(root, 'touch --reference=.git/config src/x');
    rejected(root, 'mkdir .git');
    rejected(root, `touch ${join(root, '.git', 'config')}`);
    await symlink('.git', join(root, 'meta'));
    rejected(root, 'touch meta/config');
  } finally { await cleanup(); }
});

test('R4: git options that write files or change what git executes are rejected (also abbreviated)', async () => {
  const { root, cleanup } = await repo();
  try {
    rejected(root, 'git log --output=out.txt');
    rejected(root, 'git log --output out.txt');
    rejected(root, 'git diff --outp=out.txt');
    rejected(root, 'git diff --ou=out.txt');
    rejected(root, 'git format-patch --output-directory patches HEAD~1');
    rejected(root, 'git format-patch -o patches HEAD~1');
    rejected(root, 'git init --template=tpl');
    rejected(root, 'git init --temp=tpl');
    rejected(root, 'git --exec-path=bin status');
    rejected(root, 'git --exec-path status');
  } finally { await cleanup(); }
});

test('R4: git subcommands that run hooks need explicit approval; plain reads do not', () => {
  for (const cmd of ['git commit -m x', 'git commit -F msg.txt', 'git merge main', 'git pull', 'git am x.patch', 'git format-patch HEAD~1']) {
    assert.equal(explicit(cmd), true, cmd);
  }
  for (const cmd of ['git status', 'git log -1', 'git diff', 'git add msg.txt']) {
    assert.equal(explicit(cmd), false, cmd);
  }
});
