// test/debate-participants.test.mjs — specs/014-debate R2, R4, R5, R29.
//
// Quién debate contra quién sale de la config, con la MISMA mecánica que los roles del harness
// (`cli.roles`): así el debate hereda gratis el re-anclaje al cambiar de proveedor y la detección de
// modelos que ya no existen, en vez de tener su propia copia que se desincroniza.

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveParticipants } from '../lib/debate/participants.mjs';

const cfgBase = (roles) => ({
  provider: 'openrouter',
  apiKey: 'sk-or-BASE',
  model: 'anthropic/claude-sonnet-4.6',
  cli: { rolesFor: 'openrouter', roles }
});

test('sin participantes configurados lo dice, y no inventa un debate de un modelo consigo mismo (R3)', () => {
  const r = resolveParticipants(cfgBase({}));
  assert.equal(r.configured, false);
  assert.equal(r.a, null);
  assert.equal(r.b, null);
});

test('con un solo participante tampoco hay debate (R3)', () => {
  assert.equal(resolveParticipants(cfgBase({ debateA: 'x-ai/grok-4' })).configured, false);
});

test('cada participante corre en SU proveedor, con SU key, y con la postura que le toca (R2, R8)', () => {
  const r = resolveParticipants(cfgBase({
    debateA: 'x-ai/grok-4',
    debateB: { provider: 'openai', model: 'gpt-5', apiKey: 'sk-OPENAI' }
  }));

  assert.equal(r.configured, true);
  assert.equal(r.a.stance, 'proponent');
  assert.equal(r.a.model, 'x-ai/grok-4');
  assert.equal(r.a.provider, 'openrouter');
  assert.equal(r.a.cfg.apiKey, 'sk-or-BASE');       // mismo proveedor: hereda la key base

  assert.equal(r.b.stance, 'challenger');
  assert.equal(r.b.provider, 'openai');
  assert.equal(r.b.cfg.apiKey, 'sk-OPENAI');
  assert.equal(r.b.cfg.baseURL, undefined);          // otro proveedor: NO hereda el endpoint base
});

test('el gasto de cada participante queda etiquetado como debate (R29)', () => {
  const r = resolveParticipants(cfgBase({ debateA: 'a/uno', debateB: 'b/dos' }));
  assert.equal(r.a.cfg.task, 'debate');
  assert.equal(r.b.cfg.task, 'debate');
});

test('dos participantes idénticos avisan pero NO bloquean (R4)', () => {
  const r = resolveParticipants(cfgBase({ debateA: 'x-ai/grok-4', debateB: 'x-ai/grok-4' }));
  assert.equal(r.configured, true);
  assert.ok(r.warnings.includes('same-model'));
});

test('mismo nombre de modelo en proveedores distintos NO es el mismo participante (R4)', () => {
  const r = resolveParticipants(cfgBase({
    debateA: { provider: 'openai', model: 'gpt-5', apiKey: 'k1' },
    debateB: { provider: 'openrouter', model: 'gpt-5', apiKey: 'k2' }
  }));
  assert.equal(r.warnings.includes('same-model'), false);
});

test('un participante fijado para otro proveedor cae al modelo base y avisa, no revienta (R5)', () => {
  // `gpt-oss:20b` es de Ollama; enviado a OpenRouter da 400. Antes que fallar la llamada, se debate
  // con el modelo base y se dice que ese lado no es el que el usuario configuró.
  const cfg = { provider: 'openrouter', apiKey: 'k', model: 'anthropic/claude-sonnet-4.6', cli: { rolesFor: 'ollama', roles: { debateA: 'gpt-oss:20b', debateB: 'x-ai/grok-4' } } };
  const r = resolveParticipants(cfg);

  assert.equal(r.configured, true);
  assert.equal(r.a.model, 'anthropic/claude-sonnet-4.6');
  assert.ok(r.warnings.includes('stale:a'));
});

test('el juez es opcional: sin configurar, lo asume un participante y queda constancia (R22)', () => {
  const sinJuez = resolveParticipants(cfgBase({ debateA: 'a/uno', debateB: 'b/dos' }));
  assert.equal(sinJuez.judge.model, 'a/uno');
  assert.equal(sinJuez.judgeIsParticipant, true);   // juez y parte: el informe tiene que decirlo

  const conJuez = resolveParticipants(cfgBase({ debateA: 'a/uno', debateB: 'b/dos', debateJudge: { provider: 'openai', model: 'gpt-5', apiKey: 'k' } }));
  assert.equal(conJuez.judge.model, 'gpt-5');
  assert.equal(conJuez.judgeIsParticipant, false);
});

test('una config vacía o nula no lanza', () => {
  for (const cfg of [null, undefined, {}, { cli: {} }]) {
    assert.equal(resolveParticipants(cfg).configured, false);
  }
});
