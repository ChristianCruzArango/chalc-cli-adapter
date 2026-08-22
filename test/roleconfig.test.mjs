// test/roleconfig.test.mjs — specs/014-debate R2 (y D1: la extracción a lib/).
//
// El invariante que sostiene TODA la feature del debate: cada participante corre donde dice su
// entrada de config, con SUS credenciales. Cruzarlas —mandar la key de OpenRouter a OpenAI— no da
// un resultado peor, da un 401: el debate se cae en el primer turno.
//
// Vive en test/ propio (no dentro de cli-session) porque la función ya no es del harness: la usan
// el harness y el comando `debate`, dos consumidores de capas distintas.

import test from 'node:test';
import assert from 'node:assert/strict';
import { roleConfig, roleModelLabel } from '../lib/roleconfig.mjs';

// Config típica del usuario: base en OpenRouter, con un participante del debate en OpenAI.
const cfg = () => ({
  provider: 'openrouter',
  apiKey: 'sk-or-BASE',
  baseURL: 'https://openrouter.ai/api/v1',
  apiVersion: '2024-10-21',
  model: 'anthropic/claude-sonnet-4.6',
  cli: {
    maxTokens: 4096,
    rolesFor: 'openrouter',
    roles: {
      debateA: { provider: 'openai', model: 'gpt-5', apiKey: 'sk-OPENAI' },
      debateB: 'x-ai/grok-4'
    }
  }
});

test('participante en OTRO proveedor: usa su key y NO hereda las credenciales del base (R2)', () => {
  const rc = roleConfig(cfg(), 'debateA');

  assert.equal(rc.provider, 'openai');
  assert.equal(rc.model, 'gpt-5');
  assert.equal(rc.apiKey, 'sk-OPENAI');
  // lo que NO puede viajar: credenciales y endpoint del proveedor base
  assert.equal(rc.baseURL, undefined);
  assert.equal(rc.apiVersion, undefined);
});

test('participante en OTRO proveedor: las preferencias de cli SÍ se heredan (R2)', () => {
  // maxTokens, timeouts y demás no son credenciales: son cómo trabaja el CLI, y valen para los dos lados.
  assert.equal(roleConfig(cfg(), 'debateA').cli.maxTokens, 4096);
});

test('roleConfig no conoce los nombres de rol: debateA/debateB funcionan como planner/coder (D1)', () => {
  // Si conociera los roles, añadir el debate habría sido tocar esta función. No lo es.
  const rc = roleConfig(cfg(), 'debateB');
  assert.equal(rc.provider, 'openrouter');          // string = otro modelo del MISMO proveedor
  assert.equal(rc.model, 'x-ai/grok-4');
  assert.equal(rc.apiKey, 'sk-or-BASE');            // ahí sí hereda: es el mismo servicio
});

test('participante sin configurar → null (usa el modelo base), sin inventarse nada', () => {
  assert.equal(roleConfig(cfg(), 'debateZ'), null);
  assert.equal(roleConfig({}, 'debateA'), null);
});

test('participante en objeto incompleto → null en vez de una llamada que reventará', () => {
  const incompleto = { provider: 'openrouter', cli: { roles: { debateA: { provider: 'openai' } } } };
  assert.equal(roleConfig(incompleto, 'debateA'), null);
});

test('participante fijado como string cuando el proveedor base era OTRO se descarta (R5)', () => {
  // `gpt-oss:20b` es una etiqueta de Ollama; enviada a OpenRouter da 400 "not a valid model ID".
  const stale = { provider: 'openrouter', model: 'anthropic/claude-sonnet-4.6', cli: { rolesFor: 'ollama', roles: { debateA: 'gpt-oss:20b' } } };
  assert.equal(roleConfig(stale, 'debateA'), null);
  assert.equal(roleModelLabel(stale, 'debateA'), null);
});

test('la etiqueta de UI dice el proveedor solo cuando el participante corre fuera del base', () => {
  assert.equal(roleModelLabel(cfg(), 'debateA'), 'gpt-5 (openai)');
  assert.equal(roleModelLabel(cfg(), 'debateB'), 'x-ai/grok-4');
  assert.equal(roleModelLabel(cfg(), 'debateZ'), null);
});
