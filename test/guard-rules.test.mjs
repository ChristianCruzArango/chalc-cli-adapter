// T4 (spec 017, R1, R2) — las reglas de la guarda del asistente: commit y push.
//
// La regla del usuario es «nunca commitear ni hacer push sin orden explícita». No es «nunca»: por eso
// commit y push PREGUNTAN (`ask`), y la orden la da el usuario en el momento exacto. Un push forzado
// reescribe historia ajena y no tiene vuelta atrás razonable: se bloquea (`deny`).
//
// La guarda recibe el evento `PreToolUse` de Claude Code tal cual: `{ tool_name, tool_input }`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { decide } from '../catalog/gate/lib/guard-rules.mjs';
import { shellJoin } from '../catalog/gate/lib/shellwords.mjs';

const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } });
const verdict = (command) => decide(bash(command));

test('R1: git push asks the user', () => {
  assert.deepEqual(verdict('git push'), { decision: 'ask', rule: 'git-push', data: { command: 'git push' } });
});

test('R1: git commit asks the user', () => {
  assert.deepEqual(verdict('git commit -m "x"'), { decision: 'ask', rule: 'git-commit', data: { command: 'git commit -m x' } });
});

test('R1: global options, wrappers, paths and assignments do not hide the subcommand', () => {
  for (const command of ['git -C ../x push origin main', 'GIT_TRACE=1 sudo git push', '/usr/bin/git push', 'git --no-pager commit']) {
    assert.equal(verdict(command).decision, 'ask', command);
  }
});

test('R1: a push or a commit inside a chain or a substitution is caught', () => {
  for (const command of ['npm test && git push', 'git add . ; git commit -m x', 'echo $(git push)', '(cd api && git push)']) {
    assert.equal(verdict(command).decision, 'ask', command);
  }
});

test('R1: the command reported is the simple command that matched', () => {
  assert.equal(verdict('npm test && git push origin main').data.command, 'git push origin main');
});

test('R1: other git commands, and git words that are only text, are allowed', () => {
  for (const command of ['git status', 'git log --oneline', 'git commit-tree abc', 'echo "git push"', 'grep -r "git commit" docs', 'npm test']) {
    assert.deepEqual(verdict(command), { decision: 'allow', rule: '', data: {} }, command);
  }
});

test('R2: a forced push is denied', () => {
  for (const command of [
    'git push --force', 'git push -f', 'git push --force-with-lease', 'git push --force-with-lease=main:abc',
    'git push --force-if-includes', 'git push -uf origin main', 'git push origin +main', 'git push origin +HEAD:main'
  ]) {
    const { decision, rule } = verdict(command);
    assert.deepEqual({ decision, rule }, { decision: 'deny', rule: 'git-push-force' }, command);
  }
});

test('R2: options that only look like force are a normal push', () => {
  for (const command of ['git push --follow-tags', 'git push -o ci.skip', 'git push -u origin feature/fix+1', 'git push --no-force-with-lease']) {
    assert.equal(verdict(command).rule, 'git-push', command);
  }
});

test('R2: the most severe verdict of a chain wins', () => {
  assert.equal(verdict('git commit -m x && git push --force').decision, 'deny');
  assert.equal(verdict('git push --force && git commit -m x').decision, 'deny');
  assert.equal(verdict('git status && git commit -m x').decision, 'ask');
});

test('R5: an event that is not a Bash command is allowed', () => {
  const allow = { decision: 'allow', rule: '', data: {} };
  assert.deepEqual(decide({ tool_name: 'Write', tool_input: { file_path: 'a.js', content: 'git push' } }), allow);
  assert.deepEqual(decide({ tool_name: 'Bash' }), allow);
  assert.deepEqual(decide({ tool_name: 'Bash', tool_input: { command: 42 } }), allow);
  assert.deepEqual(decide({}), allow);
  assert.deepEqual(decide(undefined), allow);
});

// Los casos de abajo salen de la pasada de mutación: cada uno fija un borde que ningún caso anterior
// distinguía, y uno de ellos (`-ofix`) era un falso positivo real.

test('R2: -f counts wherever it is in a group of short options', () => {
  assert.equal(verdict('git push -fu origin main').rule, 'git-push-force');
});

test('R2: the value glued to -o is not a group of short options', () => {
  assert.equal(verdict('git push -ofix').rule, 'git-push');
  assert.equal(verdict('git push -ofix.skip').rule, 'git-push');
});

test('R2: a branch whose name contains -f or --force is not a forced push', () => {
  for (const command of ['git push origin release-fix', 'git push origin fix--force']) {
    assert.equal(verdict(command).rule, 'git-push', command);
  }
});

test('R2: a denied push reports the command that matched', () => {
  assert.deepEqual(verdict('npm test && git push -f').data, { command: 'git push -f' });
});

test('R1: push and commit of other tools are not git', () => {
  for (const command of ['hg push', 'svn commit -m x', 'npm push']) assert.equal(verdict(command).decision, 'allow', command);
});

test('R1: with the same severity, the first command of the chain is the one reported', () => {
  assert.equal(verdict('git commit -m x && git push').data.command, 'git commit -m x');
});

test('R5: only the Bash tool and only a string command are read', () => {
  assert.equal(decide({ tool_name: 'Write', tool_input: { command: 'git push' } }).decision, 'allow');
  assert.equal(decide({ tool_name: 'Bash', tool_input: { command: ['git push'] } }).decision, 'allow');
});

test('R11 (018): the reason quotes the command as it was written', () => {
  assert.equal(verdict('git commit -m "feat: saludo"').data.command, "git commit -m 'feat: saludo'");
});

// T2 (spec 023, R10): un comando dentro de `bash -c "…"` es tan push como uno suelto. La guarda lee la cadena
// de la shell con las mismas reglas; hasta tres niveles de anidamiento, para no recorrer sin fin.
const nested = (command, levels) => (levels ? nested(shellJoin(['bash', '-c', command]), levels - 1) : command);

test('R10 (023): a commit or a push run through a shell with -c asks the user', () => {
  for (const command of ['bash -c "git push"', 'sh -c "git commit -m x"', 'zsh -lc "git push origin main"', 'env bash -c "git push"']) {
    assert.equal(verdict(command).decision, 'ask', command);
  }
  assert.deepEqual(verdict('bash -c "git push origin main"').data, { command: 'git push origin main' });
});

test('R10 (023): a forced push through a shell is denied', () => {
  assert.equal(verdict('sh -c "git push -f"').decision, 'deny');
  assert.equal(verdict('bash -c "npm test && git push --force"').decision, 'deny');
});

test('R10 (023): a chain inside the script, and a script inside a chain, are both read', () => {
  assert.equal(verdict('bash -c "git add . && git commit -m x"').data.command, 'git commit -m x');
  assert.equal(verdict('npm test && bash -c "git push"').decision, 'ask');
});

test('R10 (023): up to three nested shells are read; a fourth is not', () => {
  assert.equal(verdict(nested('git push', 3)).decision, 'ask');
  assert.equal(verdict(nested('git push', 4)).decision, 'allow');
});

// Como se escribe a mano: el nivel de dentro va entre comillas dobles escapadas (lo encontró el E2E).
test('R10 (023): nested shells written with escaped double quotes are read too', () => {
  assert.equal(verdict('sh -c "bash -c \\"git commit -m x\\""').decision, 'ask');
  assert.equal(verdict('bash -c "sh -c \\"git push --force\\""').decision, 'deny');
});

test('R10 (023): a shell whose script does nothing guarded, or that runs a file, is allowed', () => {
  for (const command of ['bash -c "ls -la"', 'bash deploy.sh', 'bash -c']) {
    assert.equal(verdict(command).decision, 'allow', command);
  }
});

test('R10 (023): reading a credentials file through a shell is denied like a direct read', () => {
  assert.equal(verdict('bash -c "cat .env"').decision, 'deny');
});

test('R10 (023): a cd inside the script does not move the outer shell for the delete rule', () => {
  const event = { ...bash('bash -c "cd /" && rm -rf dist'), cwd: process.cwd() };
  assert.equal(decide(event).decision, 'allow');
});
