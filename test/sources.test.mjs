import test from 'node:test';
import assert from 'node:assert/strict';
import { externalHttpUrl } from '../lib/net.mjs';
import { fetchUrl } from '../lib/sources.mjs';

test('externalHttpUrl rejects unsafe protocols and local hosts', () => {
  assert.throws(() => externalHttpUrl('file:///etc/passwd'), /Protocolo no permitido/);
  assert.throws(() => externalHttpUrl('http://localhost:3000'), /Host local no permitido/);
  assert.throws(() => externalHttpUrl('http://127.0.0.1:3000'), /privada\/local|local\/privada/);
  assert.throws(() => externalHttpUrl('http://192.168.1.10'), /privada/);
});

test('fetchUrl rejects redirects to local hosts', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('', {
    status: 302,
    headers: { location: 'http://localhost/private' }
  });

  try {
    await assert.rejects(() => fetchUrl('https://example.com/doc'), /Host local no permitido/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchUrl strips html responses and trims text', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('<p>Hello&nbsp;world</p>', {
    status: 200,
    headers: { 'content-type': 'text/html' }
  });

  try {
    assert.equal(await fetchUrl('https://example.com/doc'), 'Hello world');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
