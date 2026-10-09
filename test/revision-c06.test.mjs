// C-06 (spec 016, R21) — una sonda `/api/show` que FALLA o expira (Ollama aún arrancando) no se cachea
// para toda la sesión: el turno siguiente vuelve a preguntar. Una respuesta (también un 404 de un
// Ollama antiguo sin el endpoint) sí se cachea, como antes.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chatOllama } from '../cli/engine/model.mjs';

function fetchWith(showResponses) {
  const cap = { shows: 0, formats: [] };
  const fetchImpl = async (url, opts) => {
    if (/\/api\/show$/.test(url)) {
      const next = showResponses[Math.min(cap.shows++, showResponses.length - 1)];
      if (next instanceof Error) throw next;
      return next;
    }
    cap.formats.push(JSON.parse(opts.body).format);
    return { ok: true, json: async () => ({ message: { content: '{}' } }) };
  };
  return { cap, fetchImpl };
}
const thinking = { ok: true, json: async () => ({ capabilities: ['thinking'] }) };
const turn = (model, fetchImpl) => chatOllama({ provider: 'ollama', model }, { system: 's', user: 'u', fetchImpl });

test('R21: a failed probe is not cached — the next turn probes again and sees the thinking model', async () => {
  const { cap, fetchImpl } = fetchWith([new Error('ECONNREFUSED'), thinking]);
  await turn('arrancando-c06:1b', fetchImpl);
  await turn('arrancando-c06:1b', fetchImpl);
  assert.equal(cap.shows, 2);
  assert.deepEqual(cap.formats, ['json', undefined]);
});

test('R21: a successful probe is still cached (one probe per model)', async () => {
  const { cap, fetchImpl } = fetchWith([thinking]);
  await turn('cacheado-c06:1b', fetchImpl);
  await turn('cacheado-c06:1b', fetchImpl);
  assert.equal(cap.shows, 1);
});

test('R21: an HTTP answer without the endpoint (404) is cached as classic', async () => {
  // Aunque el cuerpo de un error dijera `thinking`, una respuesta no-ok no cuenta como señal.
  const { cap, fetchImpl } = fetchWith([{ ok: false, status: 404, json: async () => ({ capabilities: ['thinking'] }) }]);
  await turn('viejo-c06:1b', fetchImpl);
  await turn('viejo-c06:1b', fetchImpl);
  assert.equal(cap.shows, 1);
  assert.deepEqual(cap.formats, ['json', 'json']);
});
