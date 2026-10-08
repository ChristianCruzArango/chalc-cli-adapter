// M-08 — el límite de lectura del cuerpo HTTP: un servidor (de un modelo o de un MCP remoto) no puede
// llenar la memoria de chalc mandando un cuerpo sin fin, ni declarándolo ni a chorro.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readLimitedText } from '../lib/net.mjs';
import { createHttpClient } from '../cli/mcp/httpclient.mjs';
import { t } from '../lib/i18n.mjs';

// Un cuerpo que llega en los trozos dados, con las cabeceras dadas.
function fakeResponse(chunks, headers = {}) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk);
      controller.close();
    }
  });
  return { headers: new Headers(headers), body };
}

test('un content-length mayor que el tope se rechaza sin leer el cuerpo', async () => {
  const res = fakeResponse(['x'], { 'content-length': '5000' });
  await assert.rejects(() => readLimitedText(res, 100), { message: t('netTooLarge', 5000, 100) });
});

test('un cuerpo sin content-length que crece por encima del tope se corta al pasarlo', async () => {
  const res = fakeResponse(['a'.repeat(60), 'b'.repeat(60)]);
  await assert.rejects(() => readLimitedText(res, 100), { message: t('netTooLargeStream', 100) });
});

test('un cuerpo dentro del tope se lee entero, aunque un carácter multibyte quede partido entre trozos', async () => {
  const bytes = new TextEncoder().encode('año ✓');
  const res = fakeResponse([bytes.slice(0, 2), bytes.slice(2)]);
  assert.equal(await readLimitedText(res, 100), 'año ✓');
});

test('justo en el tope se acepta: el límite es «más de», no «hasta»', async () => {
  assert.equal(await readLimitedText(fakeResponse(['z'.repeat(100)]), 100), 'z'.repeat(100));
});

test('el cliente MCP HTTP corta un stream SSE que supera su tope sin esperar a que termine', async () => {
  const filler = `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: 'otro', result: 'x'.repeat(64 * 1024) })}\n\n`;
  const server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      // Nunca llega la respuesta con el id pedido: solo relleno, sin fin.
      const pump = () => { while (res.write(filler)) { /* hasta llenar el búfer */ } };
      res.on('drain', pump);
      pump();
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const client = createHttpClient({ url: `http://127.0.0.1:${server.address().port}/`, timeoutMs: 20000, allowPrivate: true });
    const start = Date.now();
    await assert.rejects(() => client.listTools(), { message: t('mcpSseTooLarge', 8 * 1024 * 1024) });   // MAX_RESPONSE_BYTES
    assert.ok(Date.now() - start < 15000, 'se corta por tamaño, no por timeout');
  } finally { server.close(); server.closeAllConnections?.(); }
});
