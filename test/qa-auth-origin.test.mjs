// S-08 — el token de la sesión de QA solo viaja al origen de la app que se prueba.

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { authRoute, seedStorage } from '../lib/qaagent.mjs';

const AUTH = { authorization: 'Bearer tok-123' };

function fakeRoute(url) {
  const calls = [];
  return {
    calls,
    request: () => ({ url: () => url, headers: () => ({ accept: '*/*' }) }),
    continue: async (opts) => { calls.push(opts); }
  };
}

test('the session header is added to requests for the app origin only', async () => {
  const handler = authRoute('http://localhost:4200', AUTH);
  for (const [url, expected] of [
    ['http://localhost:4200/api/me', { headers: { accept: '*/*', ...AUTH } }],
    ['https://cdn.example.com/lib.js', undefined],
    ['http://localhost:4201/other', undefined],
    ['https://analytics.example.net/collect', undefined],
    ['data:text/plain,x', undefined]
  ]) {
    const route = fakeRoute(url);
    await handler(route);
    assert.deepEqual(route.calls, [expected], url);
  }
});

test('the init script writes the stored session only on the app origin', () => {
  const items = [{ type: 'local', key: 'token', value: 'tok-123' }, { type: 'session', key: 'sid', value: 's' }];
  for (const [origin, expected] of [['http://localhost:4200', 2], ['https://ads.example.com', 0]]) {
    const written = [];
    const storage = { setItem: (k, v) => written.push([k, v]) };
    vm.runInNewContext(`(${seedStorage})(args)`, {
      location: { origin }, localStorage: storage, sessionStorage: storage,
      args: { origin: 'http://localhost:4200', items }
    });
    assert.equal(written.length, expected, origin);
  }
});
