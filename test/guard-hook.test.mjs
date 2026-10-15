// T7 (spec 017, R5) — el punto de entrada del hook `PreToolUse` de Claude Code.
//
// La guarda corre DENTRO del turno del asistente. Dos cosas no puede hacer nunca: romper el turno
// (salir con error) ni colgarlo (esperar una entrada que no llega). Y una tercera, menos obvia: cuando
// todo está bien NO responde nada. Responder `allow` aprobaría la acción saltándose los permisos que
// el usuario tiene configurados; callar deja que Claude Code siga su flujo normal.
//
// La raíz del proyecto la da `CLAUDE_PROJECT_DIR` (Claude Code la pasa a sus hooks); el `cwd` del
// evento es dónde está la shell ahora, que puede ser una subcarpeta.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { guardEvent, hookOutput } from '../catalog/gate/guard.mjs';
import { RULES } from '../catalog/gate/lib/rules.mjs';
import { MESSAGES } from '../catalog/gate/lib/i18n.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(ROOT, 'catalog', 'gate', 'guard.mjs');
const GUARD_RULES = ['guardGitCommit', 'guardGitPush', 'guardGitPushForce', 'guardSecretRead', 'guardDeleteOutside'];

const project = () => mkdtemp(join(tmpdir(), 'chalc-guard-'));
const bash = (command, cwd) => JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd });

async function withLanguage(root, language) {
  await mkdir(join(root, '.chalc'), { recursive: true });
  await writeFile(join(root, '.chalc', 'gate.json'), JSON.stringify({ language }));
  return root;
}

// Lanza la guarda como la lanza Claude Code: el evento por stdin, la raíz por entorno.
function run({ stdin, cwd, env = {} }) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [GUARD], {
      cwd, env: { ...process.env, CLAUDE_PROJECT_DIR: '', ...env }, stdio: [stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe']
    });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    const timer = setTimeout(() => child.kill(), 5000);
    child.on('close', (code) => { clearTimeout(timer); done({ code, out }); });
    if (stdin !== undefined) child.stdin.end(stdin);
  });
}

test('R5: every guard rule has a stable id and a text in both languages', () => {
  for (const key of GUARD_RULES) {
    assert.equal(typeof RULES[key], 'string', key);
    assert.equal(typeof MESSAGES.es[RULES[key]], 'function', `es ${key}`);
    assert.equal(typeof MESSAGES.en[RULES[key]], 'function', `en ${key}`);
  }
});

test('R5: an allowed action produces no output at all', () => {
  assert.equal(hookOutput({ decision: 'allow', rule: '', data: {} }, 'en'), null);
});

test('R5: ask and deny produce the PreToolUse answer of Claude Code with a reason', () => {
  const out = hookOutput({ decision: 'deny', rule: RULES.guardSecretRead, data: { path: '.env' } }, 'en');
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /\.env/);
  assert.equal(hookOutput({ decision: 'ask', rule: RULES.guardGitPush, data: { command: 'git push' } }, 'en').hookSpecificOutput.permissionDecision, 'ask');
});

test('R5: the reason names what was matched, in each language', () => {
  const cases = [
    [RULES.guardGitPush, { command: 'git push origin main' }, 'git push origin main'],
    [RULES.guardGitCommit, { command: 'git commit -m x' }, 'git commit -m x'],
    [RULES.guardGitPushForce, { command: 'git push -f' }, 'git push -f'],
    [RULES.guardSecretRead, { path: 'config/.env' }, 'config/.env'],
    [RULES.guardDeleteOutside, { command: 'rm -rf ../x', target: '../x' }, '../x']
  ];
  for (const lang of ['es', 'en']) {
    for (const [rule, data, shown] of cases) {
      const reason = hookOutput({ decision: 'deny', rule, data }, lang).hookSpecificOutput.permissionDecisionReason;
      assert.ok(reason.includes(shown), `${lang} ${rule}: ${reason}`);
    }
  }
  assert.notEqual(
    hookOutput({ decision: 'ask', rule: RULES.guardGitPush, data: { command: 'git push' } }, 'es').hookSpecificOutput.permissionDecisionReason,
    hookOutput({ decision: 'ask', rule: RULES.guardGitPush, data: { command: 'git push' } }, 'en').hookSpecificOutput.permissionDecisionReason
  );
});

test('R5: the guard speaks the language of the project (gate.json)', async () => {
  const root = await withLanguage(await project(), 'es');
  const out = await guardEvent(bash('git push', root), { root });
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /confirm/i);
  assert.equal(out.hookSpecificOutput.permissionDecisionReason, MESSAGES.es[RULES.guardGitPush]({ command: 'git push' }));
});

test('R5: an unreadable event, or one that is allowed, gives no answer', async () => {
  const root = await project();
  assert.equal(await guardEvent('not json', { root }), null);
  assert.equal(await guardEvent('', { root }), null);
  assert.equal(await guardEvent(bash('npm test', root), { root }), null);
});

test('R5: as a process it prints the answer and exits 0', async () => {
  const root = await project();
  const { code, out } = await run({ stdin: bash('git push --force', root), cwd: root, env: { CLAUDE_PROJECT_DIR: root } });
  assert.equal(code, 0);
  assert.equal(JSON.parse(out).hookSpecificOutput.permissionDecision, 'deny');
});

test('R5: as a process it stays silent and exits 0 on garbage, on an allowed action and without stdin', async () => {
  const root = await project();
  for (const stdin of ['{{{', bash('ls', root), undefined]) {
    const { code, out } = await run({ stdin, cwd: root, env: { CLAUDE_PROJECT_DIR: root } });
    assert.deepEqual({ code, out }, { code: 0, out: '' }, String(stdin));
  }
});

test('R5: the project root comes from CLAUDE_PROJECT_DIR, not from where the shell is', async () => {
  const root = await project();
  const src = join(root, 'src');
  await mkdir(src);
  const inside = await run({ stdin: bash('rm -rf ../lib', src), cwd: src, env: { CLAUDE_PROJECT_DIR: root } });
  assert.equal(inside.out, '');
  const unset = await run({ stdin: bash('rm -rf ../lib', src), cwd: src });
  assert.equal(JSON.parse(unset.out).hookSpecificOutput.permissionDecision, 'deny');
});

// T2 (spec 023, R10): el caso que se escapaba, ahora desde el proceso real, como lo lanza Claude Code.
test('R10 (023): as a process, a push wrapped in bash -c asks the user', async () => {
  const root = await project();
  const { code, out } = await run({ stdin: bash('bash -c "git push"', root), cwd: root, env: { CLAUDE_PROJECT_DIR: root } });
  assert.equal(code, 0);
  assert.equal(JSON.parse(out).hookSpecificOutput.permissionDecision, 'ask');
});
