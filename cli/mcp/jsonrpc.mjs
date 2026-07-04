// cli/mcp/jsonrpc.mjs — dispatcher JSON-RPC 2.0 (núcleo puro, sin transporte). Responsabilidad única:
// generar ids, correlacionar respuestas con sus requests y aplicar timeout. El transporte (stdio) lo inyecta
// el cliente vía `send`. Separado así para testear la lógica sin spawnear procesos.

export function createJsonRpc({ send, timeoutMs = 15000 } = {}) {
  if (typeof send !== 'function') throw new Error('createJsonRpc requiere send(message).');
  let nextId = 1;
  const pending = new Map();

  return {
    // Envía un request y espera su respuesta correlacionada por id. Rechaza al vencer el timeout.
    // opts.timeoutMs permite alargar por-request (p. ej. tools/call que ejecutan generadores lentos).
    request(method, params, opts = {}) {
      const id = nextId++;
      const limit = opts.timeoutMs || timeoutMs;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`timeout esperando ${method}`)); }, limit);
        timer.unref?.();   // no mantener vivo el event loop por un request pendiente
        pending.set(id, { resolve, reject, timer });
        send({ jsonrpc: '2.0', id, method, params });
      });
    },

    // Notificación: sin id, sin respuesta esperada.
    notify(method, params) {
      send({ jsonrpc: '2.0', method, params });
    },

    // Procesa un mensaje entrante. Ignora lo que no correlacione con un request pendiente (notificaciones del server).
    handle(msg) {
      if (msg == null || msg.id == null || !pending.has(msg.id)) return;
      const { resolve, reject, timer } = pending.get(msg.id);
      clearTimeout(timer);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message || `error JSON-RPC ${msg.error.code ?? ''}`.trim()));
      else resolve(msg.result);
    },

    // Cierra: rechaza todo lo pendiente (p. ej. el server murió).
    close(err) {
      const reason = err || new Error('conexión cerrada');
      for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(reason); }
      pending.clear();
    }
  };
}
