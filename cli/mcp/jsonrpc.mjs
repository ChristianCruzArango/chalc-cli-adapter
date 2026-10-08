// cli/mcp/jsonrpc.mjs — dispatcher JSON-RPC 2.0 (núcleo puro, sin transporte). Responsabilidad única:
// generar ids, correlacionar respuestas con sus requests y aplicar timeout. El transporte (stdio) lo inyecta
// el cliente vía `send`. Separado así para testear la lógica sin spawnear procesos.

import { MCP_REQUEST_TIMEOUT_MS } from './clientinfo.mjs';

// Envía un request y espera su respuesta correlacionada por id. Rechaza al vencer el timeout.
// opts.timeoutMs permite alargar por-request (p. ej. tools/call que ejecutan generadores lentos).
// El timer va REFERENCIADO a propósito: con unref, si el event loop se queda sin trabajo (server
// muerto), en Node 20 el timeout jamás dispara y la promesa queda pendiente para siempre. No
// retiene el proceso al salir: close() limpia todos los timers pendientes.
function request(state, method, params, opts = {}) {
  if (state.closedWith) return Promise.reject(state.closedWith);   // conexión ya cerrada: sin envíos al vacío
  const id = state.nextId++;
  const limit = opts.timeoutMs || state.timeoutMs;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { state.pending.delete(id); reject(new Error(`timeout esperando ${method}`)); }, limit);
    state.pending.set(id, { resolve, reject, timer });
    try { state.send({ jsonrpc: '2.0', id, method, params }); } catch (e) {
      clearTimeout(timer);
      state.pending.delete(id);
      reject(e);   // transporte roto (stream destruido): rechazo inmediato, no esperar el timeout
    }
  });
}

// Procesa un mensaje entrante. Ignora lo que no correlacione con un request pendiente (notificaciones del server).
function handle(state, msg) {
  if (msg == null || msg.id == null || !state.pending.has(msg.id)) return;
  const { resolve, reject, timer } = state.pending.get(msg.id);
  clearTimeout(timer);
  state.pending.delete(msg.id);
  if (msg.error) reject(new Error(msg.error.message || `error JSON-RPC ${msg.error.code ?? ''}`.trim()));
  else resolve(msg.result);
}

// Cierra: rechaza todo lo pendiente (p. ej. el server murió) y deja el dispatcher CERRADO —
// cualquier request posterior rechaza al instante con la misma razón (nada de escribirle a un
// proceso muerto y confiar en que el sistema emita el error).
function close(state, err) {
  const reason = state.closedWith || err || new Error('conexión cerrada');
  state.closedWith = reason;
  for (const { reject, timer } of state.pending.values()) { clearTimeout(timer); reject(reason); }
  state.pending.clear();
}

export function createJsonRpc({ send, timeoutMs = MCP_REQUEST_TIMEOUT_MS } = {}) {
  if (typeof send !== 'function') throw new Error('createJsonRpc requiere send(message).');
  // closedWith: tras close(), la razón — un request posterior rechaza de inmediato.
  const state = { send, timeoutMs, nextId: 1, closedWith: null, pending: new Map() };
  return {
    request: (method, params, opts) => request(state, method, params, opts),
    // Notificación: sin id, sin respuesta esperada.
    notify(method, params) { send({ jsonrpc: '2.0', method, params }); },
    handle: (msg) => handle(state, msg),
    close: (err) => close(state, err)
  };
}
