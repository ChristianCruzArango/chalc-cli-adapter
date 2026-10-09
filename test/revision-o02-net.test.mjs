// O-02 / M-03 (spec 016, R25 y R30) — los errores de red de lib/net.mjs: el plazo o la cancelación se
// informan con su mensaje traducido y cualquier otro fallo pasa intacto; los guardas de host dicen por
// qué rechazan. Sin red: `fetchImpl` inyectado y un dominio `.invalid`, que nunca resuelve.

import test from 'node:test';
import assert from 'node:assert/strict';
import { t } from '../lib/i18n.mjs';
import { assertPublicHost, assertPublicUrl, fetchWithTimeout } from '../lib/net.mjs';

const failingWith = (err) => async () => { throw err; };

test('R25: an aborted or timed-out request is reported as a timeout for that url', async () => {
  for (const name of ['AbortError', 'TimeoutError']) {
    const err = Object.assign(new Error('x'), { name });
    await assert.rejects(fetchWithTimeout('https://example.com/a', { fetchImpl: failingWith(err) }), { message: t('netTimeout', 'https://example.com/a') });
  }
});

test('R25: any other network failure reaches the caller untouched', async () => {
  const err = Object.assign(new Error('ECONNRESET'), { name: 'Error', code: 'ECONNRESET' });
  await assert.rejects(fetchWithTimeout('https://example.com/a', { fetchImpl: failingWith(err) }), (e) => e === err);
  await assert.rejects(fetchWithTimeout('https://example.com/a', { fetchImpl: failingWith(null) }), (e) => e === null);
});

test('R25: the caller signal reaches the request', async () => {
  const signal = AbortSignal.abort();
  let seen;
  await fetchWithTimeout('https://example.com/a', { signal, fetchImpl: async (_url, init) => { seen = init.signal; return { ok: true }; } });
  assert.equal(seen.aborted, true);
});

test('R30: a missing host is rejected with its translated reason', () => {
  for (const host of ['', '[]', null]) assert.throws(() => assertPublicHost(host), { message: t('netNoHost') });
});

test('R30: an unresolvable host is rejected naming that host', async () => {
  await assert.rejects(assertPublicUrl('https://chalc-no-such-host.invalid/x'), { message: t('netUnresolvable', 'chalc-no-such-host.invalid') });
});
