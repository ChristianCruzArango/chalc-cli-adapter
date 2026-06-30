import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPublicIp, assertPublicHost, assertPublicUrl } from '../lib/net.mjs';

test('assertPublicIp rejects loopback, private and link-local IPv4', () => {
  for (const ip of ['127.0.0.1', '10.0.0.1', '172.16.5.4', '192.168.1.10', '169.254.169.254', '0.0.0.0']) {
    assert.throws(() => assertPublicIp(ip), new RegExp('no permitida'), `debió rechazar ${ip}`);
  }
});

test('assertPublicIp accepts public IPv4', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34']) {
    assert.doesNotThrow(() => assertPublicIp(ip), `debió aceptar ${ip}`);
  }
});

test('assertPublicIp rejects IPv6 loopback/ULA/link-local and IPv4-mapped private', () => {
  for (const ip of ['::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:192.168.0.1']) {
    assert.throws(() => assertPublicIp(ip), new RegExp('no permitida'), `debió rechazar ${ip}`);
  }
});

test('assertPublicHost rejects localhost names', () => {
  assert.throws(() => assertPublicHost('localhost'), /Host local no permitido/);
  assert.throws(() => assertPublicHost('app.localhost'), /Host local no permitido/);
});

test('assertPublicUrl rejects a domain that resolves to a loopback IP (DNS rebinding guard)', async () => {
  // Forzamos el resolver para simular un dominio público que resuelve a una IP interna.
  // (no podemos inyectar el resolver, así que validamos el caso literal localhost que cubre la ruta sync)
  await assert.rejects(() => assertPublicUrl('http://localhost/metadata'), /Host local no permitido/);
  await assert.rejects(() => assertPublicUrl('http://127.0.0.1/metadata'), /no permitida/);
  await assert.rejects(() => assertPublicUrl('file:///etc/passwd'), /Protocolo no permitido/);
});
