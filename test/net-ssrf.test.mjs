// S-03 — el filtro SSRF reconoce cualquier escritura de una IP interna y valida la IP a la que de
// verdad se conecta (sin ventana para DNS rebinding).

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { externalHttpUrl, assertPublicIp, guardedLookup, publicFetch } from '../lib/net.mjs';

test('every IPv6 spelling of an internal address is rejected', () => {
  for (const url of [
    'http://[::ffff:127.0.0.1]/', 'http://[::ffff:7f00:1]/', 'http://[::ffff:169.254.169.254]/', 'http://[::]/',
    'http://[fe90::1]/', 'http://[febf::1]/', 'http://[64:ff9b::7f00:1]/', 'http://[64:ff9b:1::1]/',
    'http://[::127.0.0.1]/', 'http://[2002:7f00:1::]/', 'http://[ff02::1]/', 'http://[::ffff:0:a00:1]/', 'http://[fec0::1]/'
  ]) assert.throws(() => externalHttpUrl(url), /no permitida|not allowed/, url);
});

test('special-purpose IPv4 ranges are rejected', () => {
  for (const ip of ['100.64.0.1', '100.127.255.254', '0.0.0.0', '224.0.0.1', '239.1.1.1', '255.255.255.255', '198.18.0.1', '192.0.2.1']) {
    assert.throws(() => assertPublicIp(ip), /no permitida|not allowed/, ip);
  }
});

test('public addresses, including NAT64 and mapped forms of public IPv4, are accepted', () => {
  for (const ip of ['8.8.8.8', '100.128.0.1', '2606:4700:4700::1111', '64:ff9b::808:808', '::ffff:8.8.8.8', '2a00:1450:4001::1']) {
    assert.doesNotThrow(() => assertPublicIp(ip), ip);
  }
});

test('the connection lookup rejects a name that resolves to loopback', async () => {
  const err = await new Promise((resolve) => guardedLookup('localhost', { all: true }, (e) => resolve(e)));
  assert.match(String(err?.message), /no permitida|not allowed/);
});

test('publicFetch never reaches a loopback server, even through a mapped IPv6 literal', async () => {
  let hits = 0;
  const server = createServer((req, res) => { hits++; res.end('secret'); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await assert.rejects(() => publicFetch(`http://127.0.0.1:${port}/`), /no permitida|not allowed/);
    await assert.rejects(() => publicFetch(`http://[::ffff:127.0.0.1]:${port}/`), /no permitida|not allowed/);
    assert.equal(hits, 0);
  } finally {
    server.close();
  }
});
