// Spec 029 (hooks, integridad y CI), T5 — el asistente no puede saltarse los hooks de git (R6). `--no-verify`
// existe para que una persona decida; con la guarda activa, al asistente se le deniega.
import test from 'node:test';
import assert from 'node:assert/strict';
import { decide } from '../catalog/gate/lib/guard-rules.mjs';
import { RULES } from '../catalog/gate/lib/rules.mjs';
import { MESSAGES } from '../catalog/gate/lib/i18n.mjs';

const verdict = (command) => decide({ tool_name: 'Bash', tool_input: { command }, cwd: '/repo' });

test('R6: commit y push con --no-verify se deniegan, se escriban como se escriban', () => {
  for (const command of [
    'git commit --no-verify -m "x"',
    'git commit -m "x" --no-verify',
    'git commit -n -m "x"',
    'git commit -anm "x"',
    'git commit -nam "x"',
    'git push --no-verify',
    'git push origin main --no-verify',
    'git -C . commit --no-verify -m x',
    'bash -c "git commit --no-verify -m x"',
    'git add -A && git commit -n -m "x"'
  ]) {
    const out = verdict(command);
    assert.deepEqual([out.decision, out.rule], ['deny', RULES.guardNoVerify], command);
  }
});

test('R6: sin --no-verify, commit y push siguen pidiendo la orden del usuario', () => {
  assert.equal(verdict('git commit -m "x"').decision, 'ask');
  assert.equal(verdict('git commit -am "arreglo"').decision, 'ask');
  assert.equal(verdict('git push').decision, 'ask');
});

test('R6: una n dentro del mensaje o en push no es saltarse el hook', () => {
  assert.equal(verdict('git commit -m "n"').rule, RULES.guardGitCommit);
  assert.equal(verdict('git commit -mn').rule, RULES.guardGitCommit, 'tras -m, lo que sigue es el mensaje');
  assert.equal(verdict('git commit -m "--no-verify"').rule, RULES.guardGitCommit);
  assert.equal(verdict('git push -n').rule, RULES.guardGitPush, 'en push, -n es --dry-run');
});

test('R6: un push forzado sigue siendo push forzado', () => {
  assert.equal(verdict('git push --force --no-verify').decision, 'deny');
});

test('R6: el motivo dice en es y en que saltar el hook es decisión de una persona', () => {
  const es = MESSAGES.es[RULES.guardNoVerify]({ command: 'git commit --no-verify' });
  const en = MESSAGES.en[RULES.guardNoVerify]({ command: 'git commit --no-verify' });
  assert.match(es, /persona|usuario/);
  assert.match(en, /person|user/);
  assert.ok(es.includes('git commit --no-verify') && en.includes('git commit --no-verify'));
});
