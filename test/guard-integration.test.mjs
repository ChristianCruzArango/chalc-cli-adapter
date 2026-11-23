// Spec 035 (integración), T4 — la fusión de la rama de integración es del usuario (R11): es la aprobación del
// cierre. La guarda del asistente la deniega, la traiga como la traiga.
import test from 'node:test';
import assert from 'node:assert/strict';
import { decide } from '../catalog/gate/lib/guard-rules.mjs';
import { RULES } from '../catalog/gate/lib/rules.mjs';
import { messageOf } from '../catalog/gate/lib/i18n.mjs';

const bash = (command) => decide({ tool_name: 'Bash', tool_input: { command } });

test('R11: fusionar, rebasar, traer o copiar commits de chalc/int-… se deniega', () => {
  for (const command of ['git merge chalc/int-pagos', 'git merge --no-ff --no-edit chalc/int-pagos', 'git -C ../repo merge chalc/int-pagos', 'git rebase chalc/int-pagos',
    'git cherry-pick chalc/int-pagos', 'git pull . chalc/int-pagos', 'git merge refs/heads/chalc/int-pagos', 'cd repo && git merge chalc/int-pagos']) {
    const out = bash(command);
    assert.deepEqual([out.decision, out.rule], ['deny', RULES.guardIntegrationMerge], command);
  }
});

test('R11: unir otras ramas, o mirar la de integración, no es asunto de esta regla', () => {
  for (const command of ['git merge feature/x', 'git merge chalc/027-checkout', 'git log chalc/int-pagos', 'git diff main chalc/int-pagos', 'git status', 'echo chalc/int-pagos']) {
    assert.notEqual(bash(command).rule, RULES.guardIntegrationMerge, command);
  }
});

test('R11: el motivo se explica en los dos idiomas', () => {
  for (const lang of ['es', 'en']) {
    const text = messageOf(RULES.guardIntegrationMerge, { command: 'git merge chalc/int-pagos' }, lang);
    assert.ok(text.includes('chalc/int-') || text.includes('git merge'), text);
    assert.notEqual(text, RULES.guardIntegrationMerge);
  }
});
