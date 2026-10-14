// T6 (spec 022, R12, S5) — el executor HTTP del agente QA no sigue redirecciones: un 302 hacia otro
// origen no se visita; se devuelve { status, location } como observación para que decida el modelo.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { httpExecutor } from '../lib/qaagent.mjs';

const listen = (handler) => new Promise((resolve) => {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1', () => resolve(server));
});
const close = (server) => new Promise((resolve) => server.close(resolve));

test('S5: un 302 a un host externo NO se sigue y la observación trae status y location', async () => {
  let externalHits = 0;
  const external = await listen((req, res) => { externalHits += 1; res.end('SECRETO EXTERNO'); });
  const externalUrl = `http://localhost:${external.address().port}/robado`;
  const app = await listen((req, res) => { res.writeHead(302, { location: externalUrl }); res.end(); });
  try {
    const exec = httpExecutor(`http://127.0.0.1:${app.address().port}`);
    const obs = await exec({ type: 'http', method: 'GET', path: '/api/salir', headers: { 'x-token': 'abc' } });
    assert.equal(externalHits, 0);
    assert.equal(obs.status, 302);
    assert.equal(obs.location, externalUrl);
    assert.equal(/SECRETO EXTERNO/.test(JSON.stringify(obs)), false);
  } finally {
    await close(app);
    await close(external);
  }
});

test('S5: el fetch se pide con redirect manual', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push(init.redirect); return { status: 200, headers: new Headers(), text: async () => '' }; };
  await httpExecutor('http://localhost:3000', { fetchImpl })({ type: 'http', path: '/x' });
  assert.deepEqual(seen, ['manual']);
});
