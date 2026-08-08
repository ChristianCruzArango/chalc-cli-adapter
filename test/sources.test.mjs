import test from 'node:test';
import assert from 'node:assert/strict';
import { externalHttpUrl } from '../lib/net.mjs';
import { fetchAzureDevOps, fetchJira, fetchUrl } from '../lib/sources.mjs';

const AZURE_URL = 'https://dev.azure.com/XM-Mercado/SICEP/_sprints/backlog/CREG/SICEP/CREG/2026/Sprint%205?workitem=599855';

// Sustituye fetch global y devuelve las llamadas capturadas para poder revisar cabeceras/URL.
function stubFetch(handler) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => { calls.push({ url: String(url), opts }); return handler(String(url), opts); };
  return { calls, restore() { globalThis.fetch = original; } };
}

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

// Azure DevOps no responde 401 cuando el PAT es inválido: devuelve 203 (o 200) con el HTML del
// login. Antes esto reventaba en res.json() con "Unexpected token '<'" y el usuario no sabía qué pasaba.
test('fetchAzureDevOps explains the sign-in page instead of crashing on JSON.parse', async () => {
  const s = stubFetch(async () => new Response('\n\n<!DOCTYPE html><html><body>Sign In</body></html>', {
    status: 203,
    headers: { 'content-type': 'text/html' }
  }));

  try {
    await assert.rejects(() => fetchAzureDevOps({ url: AZURE_URL, pat: 'bad-pat' }), (err) => {
      assert.match(err.message, /Azure DevOps/);
      assert.match(err.message, /HTML/);
      assert.doesNotMatch(err.message, /Unexpected token/);
      return true;
    });
  } finally {
    s.restore();
  }
});

test('fetchAzureDevOps reports rejected credentials on 401', async () => {
  const s = stubFetch(async () => new Response('{"message":"denied"}', { status: 401 }));

  try {
    await assert.rejects(() => fetchAzureDevOps({ url: AZURE_URL, pat: 'expired' }), /Azure DevOps.*401|401.*Azure DevOps/s);
  } finally {
    s.restore();
  }
});

test('fetchAzureDevOps hits the work item API with a trimmed PAT and no fed-auth redirect', async () => {
  const s = stubFetch(async () => new Response(JSON.stringify({
    fields: {
      'System.Title': 'Convocatorias',
      'System.Description': '<p>Como usuario&nbsp;quiero</p>',
      'Microsoft.VSTS.Common.AcceptanceCriteria': '<li>Criterio 1</li>'
    }
  }), { status: 200, headers: { 'content-type': 'application/json' } }));

  try {
    const out = await fetchAzureDevOps({ url: AZURE_URL, pat: '  secret-pat\n' });
    assert.match(s.calls[0].url, /dev\.azure\.com\/XM-Mercado\/_apis\/wit\/workitems\/599855/);
    const headers = s.calls[0].opts.headers;
    assert.equal(headers.authorization, 'Basic ' + Buffer.from(':secret-pat').toString('base64'));
    assert.equal(headers['x-tfs-fedauthredirect'], 'Suppress');
    assert.match(out, /# Convocatorias/);
    assert.match(out, /Como usuario quiero/);
    assert.match(out, /- Criterio 1/);
  } finally {
    s.restore();
  }
});

test('fetchJira explains an html login page too', async () => {
  const s = stubFetch(async () => new Response('<html>login</html>', { status: 200, headers: { 'content-type': 'text/html' } }));

  try {
    await assert.rejects(
      () => fetchJira({ url: 'https://acme.atlassian.net/browse/ABC-12', email: 'a@b.c', token: 'x' }),
      (err) => {
        assert.match(err.message, /Jira/);
        assert.match(err.message, /HTML/);
        return true;
      }
    );
  } finally {
    s.restore();
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
