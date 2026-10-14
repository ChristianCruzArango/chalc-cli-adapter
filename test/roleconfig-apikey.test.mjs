// T6 (spec 022, R18, F11) — un rol {provider, model} en un proveedor que exige key y sin `apiKey` se
// rechaza AL CARGARLO, con un error claro, en vez de producir un 401 en mitad de un debate ya pagado.

import test from 'node:test';
import assert from 'node:assert/strict';
import { roleConfig } from '../lib/roleconfig.mjs';
import { resolveParticipants } from '../lib/debate/participants.mjs';
import { t } from '../lib/i18n.mjs';

const cfg = (role) => ({ provider: 'openrouter', apiKey: 'sk-or', model: 'm', cli: { roles: { debateA: role, debateB: 'otro/modelo' } } });

test('F11: rol en proveedor con key y sin apiKey → error al cargarlo, con código y el nombre del rol', () => {
  assert.throws(() => roleConfig(cfg({ provider: 'openai', model: 'gpt-5' }), 'debateA'), (err) => {
    assert.equal(err.code, 'ROLE_NO_API_KEY');
    assert.equal(err.message, t('roleNoApiKey', 'debateA', 'openai'));
    return true;
  });
});

test('F11: el debate no arranca con un participante sin key', () => {
  assert.throws(() => resolveParticipants(cfg({ provider: 'anthropic', model: 'claude' })), /debateA/);
});

test('F11: proveedor local (sin key) o rol con su apiKey siguen valiendo', () => {
  assert.equal(roleConfig(cfg({ provider: 'ollama', model: 'llama3.1' }), 'debateA').provider, 'ollama');
  assert.equal(roleConfig(cfg({ provider: 'openai', model: 'gpt-5', apiKey: 'k' }), 'debateA').apiKey, 'k');
});
