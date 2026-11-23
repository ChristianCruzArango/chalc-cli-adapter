// Spec 039 (medición en navegador), T2 — hablar con el navegador (R1, R5): mensajes JSON separados por NUL, cada
// respuesta casada con su petición, y ningún plazo abierto: un navegador que no contesta no cuelga a nadie.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from '../catalog/design/lib/cdp.mjs';

// Un navegador de mentira: guarda lo que se le escribe y deja contestar a mano.
function fakeBrowser() {
  const sent = [];
  let deliver = () => {};
  const session = createSession({ write: (text) => sent.push(text), onData: (listener) => { deliver = listener; }, timeoutMs: 200 });
  return { session, sent, reply: (message) => deliver(Buffer.from(`${JSON.stringify(message)}\0`)), raw: (text) => deliver(Buffer.from(text)), last: () => JSON.parse(sent.at(-1).slice(0, -1)) };
}

test('R1: cada petición sale como JSON terminado en NUL, con un id que crece y su sesión si la hay', async () => {
  const { session, sent, last, reply } = fakeBrowser();
  const first = session.send('Target.createTarget', { url: 'about:blank' });
  assert.ok(sent[0].endsWith('\0'));
  assert.deepEqual(last(), { id: 1, method: 'Target.createTarget', params: { url: 'about:blank' } });
  reply({ id: 1, result: { targetId: 'T1' } });
  assert.deepEqual(await first, { targetId: 'T1' });
  const second = session.send('Page.enable', {}, 'S1');
  assert.deepEqual(last(), { id: 2, method: 'Page.enable', params: {}, sessionId: 'S1' });
  reply({ id: 2, result: {} });
  assert.deepEqual(await second, {});
});

test('R1: las respuestas se casan por id aunque lleguen desordenadas, partidas o varias juntas', async () => {
  const { session, raw } = fakeBrowser();
  const a = session.send('A.a');
  const b = session.send('B.b');
  const both = `${JSON.stringify({ id: 2, result: { n: 2 } })}\0${JSON.stringify({ id: 1, result: { n: 1 } })}\0`;
  raw(both.slice(0, 10));
  raw(both.slice(10));
  assert.deepEqual([await a, await b], [{ n: 1 }, { n: 2 }]);
});

test('R5: un error del navegador rechaza la petición con su mensaje', async () => {
  const { session, reply } = fakeBrowser();
  const failing = session.send('Page.navigate', { url: 'x' });
  reply({ id: 1, error: { code: -32000, message: 'Cannot navigate to invalid URL' } });
  await assert.rejects(failing, /Page\.navigate: Cannot navigate to invalid URL/);
});

test('R5: una petición sin respuesta vence en su plazo, y no deja nada vivo', async () => {
  const { session } = fakeBrowser();
  await assert.rejects(session.send('Page.navigate', { url: 'x' }), /Page\.navigate.*200 ms/);
});

test('R1: se puede esperar un evento, de una sesión concreta, y también vence', async () => {
  const { session, reply } = fakeBrowser();
  const loaded = session.once('Page.loadEventFired', 'S1');
  reply({ method: 'Page.loadEventFired', params: { timestamp: 1 }, sessionId: 'OTRA' });
  reply({ method: 'Page.frameNavigated', params: {}, sessionId: 'S1' });
  reply({ method: 'Page.loadEventFired', params: { timestamp: 2 }, sessionId: 'S1' });
  assert.deepEqual(await loaded, { timestamp: 2 });
  await assert.rejects(session.once('Page.loadEventFired', 'S1'), /Page\.loadEventFired.*200 ms/);
});

test('R5: basura en el canal no rompe la sesión, y cerrarla rechaza lo pendiente', async () => {
  const { session, raw, reply } = fakeBrowser();
  const pending = session.send('A.a');
  raw('no es json\0');
  reply({ id: 1, result: { ok: true } });
  assert.deepEqual(await pending, { ok: true });
  const open = session.send('B.b');
  session.close();
  await assert.rejects(open, /cerr|closed/i);
  await assert.rejects(session.send('C.c'), /cerr|closed/i);
});
