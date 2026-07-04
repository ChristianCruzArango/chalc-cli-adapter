// cli/mcp/jsonrpc.mjs — dispatcher JSON-RPC 2.0 (núcleo puro, sin transporte). Responsabilidad única:
// generar ids, correlacionar respuestas con sus requests y aplicar timeout. El transporte (stdio) lo inyecta
// el cliente vía `send`. Separado así para testear la lógica sin spawnear procesos.

export function createJsonRpc({ send, timeoutMs = 15000 } = {}) {
  if (typeof send !== 'function') throw new Error('createJsonRpc requiere send(message).');
  let nextId = 1;
  let closedWith = null;   // tras close(): la razón — un request posterior rechaza de inmediato
  const pending = new Map();

  return {
    // Envía un request y espera su respuesta correlacionada por id. Rechaza al vencer el timeout.
    // opts.timeoutMs permite alargar por-request (p. ej. tools/call que ejecutan generadores lentos).
    // El timer va REFERENCIADO a propósito: con unref, si el event loop se queda sin trabajo (server
    // muerto), en Node 20 el timeout jamás dispara y la promesa queda pendiente para siempre. No
    // retiene el proceso al salir: close() limpia todos los timers pendientes.
    request(method, params, opts = {}) {
      if (closedWith) return Promise.reject(closedWith);   // conexión ya cerrada: sin envíos al vacío
      const id = nextId++;
      const limit = opts.timeoutMs || timeoutMs;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`timeout esperando ${method}`)); }, limit);
        pending.set(id, { resolve, reject, timer });
        try { send({ jsonrpc: '2.0', id, method, params }); } catch (e) {
          clearTimeout(timer);
          pending.delete(id);
          reject(e);   // transporte roto (stream destruido): rechazo inmediato, no esperar el timeout
        }
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

    // Cierra: rechaza todo lo pendiente (p. ej. el server murió) y deja el dispatcher CERRADO —
    // cualquier request posterior rechaza al instante con la misma razón (nada de escribirle a un
    // proceso muerto y confiar en que el sistema emita el error).
    close(err) {
      const reason = closedWith || err || new Error('conexión cerrada');
      closedWith = reason;
      for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(reason); }
      pending.clear();
    }
  };
}
