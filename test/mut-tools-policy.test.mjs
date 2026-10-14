// T10 (spec 022, R1–R4, S1) — mutantes de cli/tools/{trust,gitexec,shellpolicy}.mjs.
// Qué se auto-aprueba, qué opciones de git ejecutan y los bordes de la política de la shell.

import test from 'node:test';
import assert from 'node:assert/strict';
import { symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { requiresExplicitApproval } from '../cli/tools/trust.mjs';
import { gitExecOption } from '../cli/tools/gitexec.mjs';
import { checkCommand } from '../cli/tools/shellpolicy.mjs';

const bash = (command) => requiresExplicitApproval({ tool: 'bash', args: { command } });
const write = (path) => requiresExplicitApproval({ tool: 'write', args: { path } });

test('R1: cada opción de git de la lista se auto-aprueba', () => {
  for (const opt of ['--', '--porcelain', '--oneline', '-p', '--stat', '-n', '--short', '-s', '--name-only',
    '--name-status', '--cached', '--staged', '--graph', '-l', '-i', '-w', '-A', '--all']) {
    assert.equal(bash(`git log ${opt}`), false, opt);
  }
});

test('R1: un límite numérico de git (-N) se auto-aprueba; lo que solo se le parece, no', () => {
  assert.equal(bash('git log -1'), false);
  assert.equal(bash('git log -12'), false);
  assert.equal(bash('git log -1a'), true);
  assert.equal(bash('git log --1'), true);
});

test('R3: solo `audit fix` ejecuta; otro subcomando seguido de "fix" se auto-aprueba', () => {
  assert.equal(bash('npm ls fix'), false);
  assert.equal(bash('npm audit fix'), true);
  assert.equal(bash('npm audit'), false);
});

test('R4: un comando de solo espacios no exige aprobación explícita', () => {
  assert.equal(bash('   '), false);
});

test('R2: archivos autoejecutables por nombre exacto o carpeta; no por parecido', () => {
  assert.equal(write('.claude'), true);
  assert.equal(write('sub/.husky'), true);
  assert.equal(write('.vscode/tasks.json'), true);
  assert.equal(write('app.csproj'), true);
  assert.equal(write('notas.targets.md'), false);
  assert.equal(write('.claudeignore'), false);
});

test('R1: letras cortas que ejecutan, por subcomando', () => {
  assert.equal(gitExecOption(['rebase', '-x', 'make']), '-x');
  assert.equal(gitExecOption(['difftool', '-x', 'sh']), '-x');
  assert.equal(gitExecOption(['clone', '-u', 'sh', 'url']), '-u');
  assert.equal(gitExecOption(['rebase', '-i']), null);
  assert.equal(gitExecOption(['log', '-x']), null);
  assert.equal(gitExecOption(['clone', '-x']), null);
  assert.equal(gitExecOption(['difftool', '-y']), null);
  assert.equal(gitExecOption(['clone', '-q', 'url']), null);
  assert.equal(gitExecOption(['grep', '-Osh', 'x']), '-Osh');
});

test('R1: -O solo cuenta en un grupo corto; en otro token es un dato', () => {
  assert.equal(gitExecOption(['log', 'a-O']), null);
  assert.equal(gitExecOption(['log', '--ORIG']), null);
});

test('R1: una opción larga con = se compara por su nombre', () => {
  assert.equal(gitExecOption(['log', '--exec=sh']), '--exec=sh');
  assert.equal(gitExecOption(['fetch', '--upload-pack=x']), '--upload-pack=x');
});

test('R1: subcomandos que corren un comando arbitrario, con su nombre exacto', () => {
  assert.equal(gitExecOption(['bisect', 'run', 'make']), 'bisect run');
  assert.equal(gitExecOption(['bisect', '--no-checkout', 'run', 'make']), 'bisect run');
  assert.equal(gitExecOption(['bisect', 'start']), null);
  assert.equal(gitExecOption(['submodule', 'foreach', 'sh']), 'submodule foreach');
  assert.equal(gitExecOption(['filter-branch', '--tree-filter', 'x']), 'filter-branch');
});

test('S1: el mensaje de "no permitido" lista la allowlist o dice (none)', () => {
  assert.equal(checkCommand('rm x', { root: '.', allow: [] }).error, 'command not allowed: rm. Allowed: (none)');
  assert.equal(checkCommand('rm x', { root: '.', allow: ['ls', 'cat'] }).error, 'command not allowed: rm. Allowed: ls, cat');
  assert.equal(checkCommand('ls', { root: '.', allow: ['ls'] }).error, undefined);
});

test('S1: las guardas de git no se aplican a otros binarios', () => {
  assert.equal(checkCommand('echo config user.name x', { root: '.', allow: ['echo'] }).error, undefined);
  assert.equal(checkCommand('echo -O', { root: '.', allow: ['echo'] }).error, undefined);
});

test('S1: un metacarácter rechaza y devuelve el comando tal cual', () => {
  const r = checkCommand('ls; rm x', { root: '.', allow: ['ls'] });
  assert.equal(r.command, 'ls; rm x');
  assert.match(r.error, /metacharacters/);
});

test('S1: un switch MSBuild (/p:Prop=valor) es dato aunque su valor nombre una carpeta real', { skip: process.platform === 'win32' }, async (t) => {
  const root = await tempDir(t);
  assert.equal(checkCommand('ls /p:A=/tmp', { root, allow: ['ls'] }).error, undefined);
  assert.equal(checkCommand('ls /property:B=/tmp', { root, allow: ['ls'] }).error, undefined);
});

test('S1: un enlace que sale del proyecto no se cuela por parecer un switch', async (t) => {
  const root = await tempDir(t);
  const outside = await tempDir(t);
  await symlink(outside, join(root, 'lnk'), 'junction');
  assert.match(checkCommand('ls lnk/t:x', { root, allow: ['ls'] }).error, /outside the project/);
});
