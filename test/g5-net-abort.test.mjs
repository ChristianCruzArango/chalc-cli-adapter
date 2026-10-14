// T5 (spec 022, R18, F5) — un Ctrl+C (la `signal` del llamador) NO se reetiqueta como «tiempo
// agotado»: se propaga el AbortError para que el comando salga como interrumpido (130), no como fallo.

import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithTimeout } from '../lib/net.mjs';
import { t } from '../lib/i18n.mjs';

// fetch falso que solo termina cuando le abortan la señal.
const hangingFetch = (_url, { signal }) => new Promise((_res, rej) => {
  signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
});

test('T5 R18 F5: a caller abort propagates as AbortError, not as a timeout', async () => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 10);
  const err = await fetchWithTimeout('http://x.test/', { fetchImpl: hangingFetch, signal: controller.signal, timeoutMs: 5000 }).catch((e) => e);
  assert.equal(err.name, 'AbortError');
  assert.notEqual(err.message, t('netTimeout', 'http://x.test/'));
});

test('T5 R18 F5: the own deadline is still reported as a timeout', async () => {
  const err = await fetchWithTimeout('http://x.test/', { fetchImpl: hangingFetch, timeoutMs: 10 }).catch((e) => e);
  assert.equal(err.message, t('netTimeout', 'http://x.test/'));
});
