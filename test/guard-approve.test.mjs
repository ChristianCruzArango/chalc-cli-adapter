// Spec 024 (coherencia), T6 — la guarda DENIEGA que el asistente apruebe la spec (R15 enmendado): la
// aprobación es del usuario, desde su terminal. Regla del hook y permiso `deny` nativo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { decide } from '../catalog/gate/lib/guard-rules.mjs';
import { RULES } from '../catalog/gate/lib/rules.mjs';
import { MESSAGES } from '../catalog/gate/lib/i18n.mjs';
import { GUARD_ASK, GUARD_DENY, withGuard, withoutGuard } from '../lib/guardsettings.mjs';

const bash = (command) => ({ tool_name: 'Bash', tool_input: { command }, cwd: '/repo' });

test('R15: el asistente no puede ejecutar la aprobación de la spec, se escriba como se escriba', () => {
  for (const command of [
    'node .chalc/gate.mjs --approve-spec',
    'node ./.chalc/gate.mjs --approve-spec',
    'node .chalc/gate/gate.mjs --approve-spec',
    'cd app && node .chalc/gate.mjs --approve-spec',
    'echo 007-carrito | node .chalc/gate.mjs --approve-spec',
    'bash -c "node .chalc/gate.mjs --approve-spec"',
    'node .chalc/gate.mjs --fast --approve-spec',
    'script -q /dev/null node .chalc/gate.mjs --approve-spec'
  ]) {
    const verdict = decide(bash(command));
    assert.equal(verdict.decision, 'deny', command);
    assert.equal(verdict.rule, RULES.guardApprove, command);
  }
});

test('spec 028, R6: tampoco puede aprobar el cierre', () => {
  for (const command of ['node .chalc/gate.mjs --approve-feature', 'bash -c "node .chalc/gate.mjs --approve-feature"', 'echo 007-carrito | node ./.chalc/gate.mjs --approve-feature']) {
    const verdict = decide(bash(command));
    assert.deepEqual([verdict.decision, verdict.rule], ['deny', RULES.guardApprove], command);
  }
});

test('R15: correr el portón o re-sellar comandos sigue permitido', () => {
  for (const command of ['node .chalc/gate.mjs', 'node .chalc/gate.mjs --fast', 'node .chalc/gate.mjs --seal', 'node .chalc/next.mjs', 'grep -- --approve-spec README.md']) {
    assert.equal(decide(bash(command)).decision, 'allow', command);
  }
});

test('R15, R16: el motivo dice en es y en que solo el usuario aprueba, con el comando', () => {
  for (const lang of ['es', 'en']) {
    const line = MESSAGES[lang][RULES.guardApprove]({ command: 'node .chalc/gate.mjs --approve-spec' });
    assert.ok(line.includes('node .chalc/gate.mjs --approve-spec'), lang);
  }
  assert.match(MESSAGES.es[RULES.guardApprove]({ command: 'x' }), /usuario/);
  assert.match(MESSAGES.en[RULES.guardApprove]({ command: 'x' }), /user/);
});

test('R15: activar la guarda añade el permiso deny nativo para la aprobación, sin duplicarlo', () => {
  // Las dos aprobaciones del usuario: la spec (spec 024) y el cierre (spec 028, R6).
  assert.deepEqual(GUARD_DENY, ['Bash(node .chalc/gate.mjs --approve-spec*)', 'Bash(node .chalc/gate.mjs --approve-feature*)', 'Bash(git merge chalc/int-*)']);
  const first = withGuard({});
  assert.equal(first.changed, true);
  assert.deepEqual(first.settings.permissions.deny, GUARD_DENY);
  assert.deepEqual(first.settings.permissions.ask, GUARD_ASK);
  const again = withGuard(first.settings);
  assert.equal(again.changed, false);
  assert.deepEqual(again.settings, first.settings);
});

test('R15: una guarda de una versión anterior (sin deny) recibe el permiso al re-equipar', () => {
  const old = withGuard({});
  delete old.settings.permissions.deny;
  const upgraded = withGuard(old.settings);
  assert.equal(upgraded.changed, true);
  assert.deepEqual(upgraded.settings.permissions.deny, GUARD_DENY);
});

test('R15: los deny del usuario se conservan, antes de los de chalc, al activar y al retirar', () => {
  const mine = { permissions: { deny: ['Bash(rm -rf *)'] } };
  const on = withGuard(mine);
  assert.deepEqual(on.settings.permissions.deny, ['Bash(rm -rf *)', ...GUARD_DENY]);
  const off = withoutGuard(on.settings);
  assert.equal(off.changed, true);
  assert.deepEqual(off.settings, mine);
});

test('R15: retirar la guarda no deja secciones vacías, y un deny que no es lista no se toca', () => {
  assert.deepEqual(withoutGuard(withGuard({}).settings).settings, {});
  assert.equal(withGuard({ permissions: { deny: 'x' } }), null);
  assert.equal(withoutGuard({ permissions: { deny: 'x' } }), null);
});
