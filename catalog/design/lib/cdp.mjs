// cdp.mjs — hablar con el navegador (spec 039, R1, R5). Responsabilidad ÚNICA: enviar órdenes del protocolo de
// depuración y casar cada respuesta con su petición. Razón de cambio: el canal con el navegador.
//
// Este archivo lo emite chalc dentro de `.chalc/design/lib/`. No edites aquí: se regenera al equipar el repo.
//
// El canal es la tubería de depuración (`--remote-debugging-pipe`): JSON separado por NUL, sin puertos ni
// WebSocket, así que no hay dependencias y vale en cualquier versión de Node. Ninguna espera queda abierta: un
// navegador que no contesta vence en su plazo en vez de colgar a quien mide.

const END = '\0';
export const DEFAULT_TIMEOUT_MS = 15000;

// Una espera con plazo: se resuelve con `settle`, o vence diciendo qué se esperaba.
function deadline(label, timeoutMs) {
  let settle;
  let fail;
  const promise = new Promise((resolve, reject) => { settle = resolve; fail = reject; });
  const timer = setTimeout(() => fail(new Error(`${label}: no response in ${timeoutMs} ms`)), timeoutMs);
  const done = (finish) => (value) => { clearTimeout(timer); finish(value); };
  return { promise, resolve: done(settle), reject: done(fail) };
}

/**
 * Una sesión con el navegador sobre un canal `{ write(texto), onData(oyente) }`.
 * Devuelve { send(método, params, sessionId) → resultado, once(evento, sessionId) → params, close() }.
 */
export function createSession({ write, onData, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const pending = new Map();
  const waiting = [];
  let nextId = 0;
  let buffer = '';
  let closed = false;

  function receive(message) {
    const request = pending.get(message.id);
    if (request) {
      pending.delete(message.id);
      if (message.error) request.wait.reject(new Error(`${request.method}: ${message.error.message}`));
      else request.wait.resolve(message.result || {});
      return;
    }
    const index = waiting.findIndex((w) => w.event === message.method && (!w.sessionId || w.sessionId === message.sessionId));
    if (index >= 0) waiting.splice(index, 1)[0].wait.resolve(message.params || {});
  }

  onData((chunk) => {
    const parts = (buffer + chunk.toString('utf8')).split(END);
    buffer = parts.pop();
    for (const part of parts) {
      // Lo que no es JSON se ignora: un mensaje roto no puede tumbar la medición entera.
      try { receive(JSON.parse(part)); } catch { /* basura en el canal */ }
    }
  });

  const refuse = () => Promise.reject(new Error('session closed'));
  return {
    send(method, params = {}, sessionId = '') {
      if (closed) return refuse();
      const id = (nextId += 1);
      const wait = deadline(method, timeoutMs);
      pending.set(id, { method, wait });
      wait.promise.catch(() => pending.delete(id));
      write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + END);
      return wait.promise;
    },
    once(event, sessionId = '') {
      if (closed) return refuse();
      const entry = { event, sessionId, wait: deadline(event, timeoutMs) };
      waiting.push(entry);
      entry.wait.promise.catch(() => { const index = waiting.indexOf(entry); if (index >= 0) waiting.splice(index, 1); });
      return entry.wait.promise;
    },
    close() {
      closed = true;
      for (const { wait } of [...pending.values(), ...waiting]) wait.reject(new Error('session closed'));
      pending.clear();
      waiting.length = 0;
    }
  };
}
