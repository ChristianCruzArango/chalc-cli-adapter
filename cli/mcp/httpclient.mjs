// cli/mcp/httpclient.mjs — cliente MCP REMOTO por Streamable HTTP, nativo y sin dependencias.
// Transporte estándar para servidores MCP alojados en internet (spec 2025-03-26): cada mensaje JSON-RPC
// va por POST al MISMO endpoint; la respuesta llega como application/json o como text/event-stream (SSE).
// La sesión la mantiene el header Mcp-Session-Id que el server devuelve en initialize. Misma interfaz que
// createStdioClient (start/listTools/callTool/stop), así astools no distingue local de remoto.
// Config del .mcp.json: { "url": "https://...", "headers": { "Authorization": "Bearer ${VAR}" } } —
// las referencias ${VAR} ya llegan resueltas desde el entorno (cli/project.mjs).

import { assertPublicUrl, publicFetch, readLimitedText } from '../../lib/net.mjs';
import { safeUrlForDisplay } from '../../lib/redact.mjs';
import { CLIENT_INFO, MCP_REQUEST_TIMEOUT_MS, MCP_TOOL_TIMEOUT_MS } from './clientinfo.mjs';
import { t } from '../../lib/i18n.mjs';

const PROTOCOL_VERSION = '2025-03-26';
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;   // una respuesta JSON-RPC, o lo leído de un stream SSE

function anyHttpUrl(value) {
  let parsed;
  try { parsed = new URL(String(value)); }
  catch { throw new Error(t('netBadUrl', value)); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(t('netBadProtocol', parsed.protocol));
  return parsed;
}

// El mensaje JSON-RPC de un evento SSE ("data: {...}" en una o varias líneas), o null.
function sseMessage(event) {
  const data = event.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
  if (!data) return null;
  try { return JSON.parse(data); } catch { return null; /* evento no-JSON (comentario/latido) */ }
}

// Lee el stream SSE EVENTO A EVENTO y devuelve la respuesta correlacionada con `id` en cuanto llega.
// Esperar a `res.text()` colgaba la llamada si el servidor dejaba el stream abierto tras responder,
// y no tenía tope de bytes.
async function sseResponse(res, id, maxBytes = MAX_RESPONSE_BYTES) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (value) {
        size += value.byteLength;
        if (size > maxBytes) throw new Error(t('mcpSseTooLarge', maxBytes));
        pending += decoder.decode(value, { stream: true });
      }
      const events = pending.split(/\r?\n\r?\n/);
      pending = done ? '' : events.pop();
      for (const event of events) {
        const msg = sseMessage(event);
        if (msg?.id === id) return msg;
      }
      if (done) return null;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

async function ensureSafeEndpoint(conn) {
  if (!conn.validation) conn.validation = Promise.resolve(conn.validate(conn.endpoint));
  try { await conn.validation; }
  catch (e) { throw new Error(t('mcpUrlBlocked', e?.message || e)); }
}

// El POST de un mensaje. Guarda el Mcp-Session-Id que devuelva el servidor.
async function postOnce(conn, message, signal) {
  let res;
  try {
    res = await conn.doFetch(conn.endpoint, {
      method: 'POST',
      signal,
      // Un redirect podría cambiar el host DESPUÉS de validar DNS y recibir headers con secretos.
      redirect: 'error',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': PROTOCOL_VERSION,
        ...(conn.sessionId ? { 'mcp-session-id': conn.sessionId } : {}),
        ...conn.headers
      },
      body: JSON.stringify(message)
    });
  } catch (e) {
    throw new Error(t('mcpUnreachable', conn.displayUrl, e?.name === 'AbortError' ? 'timeout' : e?.message || e));
  }
  const sid = res.headers?.get?.('mcp-session-id');
  if (sid) conn.sessionId = sid;
  if (!res.ok) throw new Error(t('mcpHttpStatus', res.status, conn.displayUrl));
  return res;
}

// La respuesta JSON-RPC, llegue como JSON o como stream SSE.
async function readReply(res, id) {
  const ctype = res.headers?.get?.('content-type') || '';
  if (ctype.includes('text/event-stream')) {
    const msg = res.body ? await sseResponse(res, id) : null;
    if (!msg) throw new Error(t('mcpSseNoAnswer'));
    return msg;
  }
  return JSON.parse(await readLimitedText(res, MAX_RESPONSE_BYTES));
}

async function post(conn, message, { expectResponse = true, timeoutMs: limit } = {}) {
  await ensureSafeEndpoint(conn);
  // El plazo cubre la petición Y la lectura del cuerpo: cancelarlo al llegar las cabeceras dejaba
  // esperando sin límite a un servidor que las manda y retrasa el cuerpo.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limit || conn.timeoutMs);
  timer.unref?.();
  try {
    const res = await postOnce(conn, message, controller.signal);
    if (!expectResponse || res.status === 202) return null;
    try { return await readReply(res, message.id); }
    catch (e) {
      if (controller.signal.aborted) throw new Error(t('mcpReadTimeout', conn.displayUrl));
      throw e;
    }
  } finally {
    clearTimeout(timer);
  }
}

async function request(conn, method, params, opts) {
  const id = conn.nextId++;
  const msg = await post(conn, { jsonrpc: '2.0', id, method, params }, opts);
  if (msg?.error) throw new Error(msg.error.message || `error JSON-RPC ${msg.error.code ?? ''}`.trim());
  return msg?.result;
}

// Cierre de sesión best-effort (DELETE con el session id); los servers sin sesión lo ignoran.
async function closeSession(conn) {
  if (!conn.sessionId) return;
  try {
    await ensureSafeEndpoint(conn);
    await conn.doFetch(conn.endpoint, { method: 'DELETE', redirect: 'error', headers: { 'mcp-session-id': conn.sessionId, ...conn.headers } });
  } catch { /* best-effort */ }
}

export function createHttpClient({ url, headers = {}, timeoutMs = MCP_REQUEST_TIMEOUT_MS, fetchImpl, allowPrivate = false, validateUrl } = {}) {
  if (!url) throw new Error(t('mcpNoUrl'));
  const endpoint = String(url);
  const conn = {
    // Sin `allowPrivate`, la IP se valida en la propia conexión (publicFetch): validar el DNS una vez y
    // dejar que cada `fetch` vuelva a resolver abría la puerta al DNS rebinding.
    doFetch: fetchImpl || (allowPrivate ? fetch : publicFetch),
    endpoint,
    displayUrl: safeUrlForDisplay(endpoint),
    headers,
    timeoutMs,
    // Público por defecto (incluye DNS completo): un .mcp.json pertenece al proyecto y no puede convertir
    // la shell en proxy hacia la red privada. El escape `allowPrivate` solo se inyecta desde config local.
    validate: validateUrl || (allowPrivate ? async (value) => anyHttpUrl(value) : assertPublicUrl),
    validation: null,
    sessionId: null,
    nextId: 1
  };

  return {
    async start() {
      await request(conn, 'initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO });
      await post(conn, { jsonrpc: '2.0', method: 'notifications/initialized', params: {} }, { expectResponse: false });
    },
    async listTools() {
      const r = await request(conn, 'tools/list', {});
      return r?.tools || [];
    },
    async callTool(name, args) {
      // Timeout largo: igual que en stdio, un tool remoto puede ejecutar operaciones lentas.
      return request(conn, 'tools/call', { name, arguments: args || {} }, { timeoutMs: MCP_TOOL_TIMEOUT_MS });
    },
    stop: () => closeSession(conn)
  };
}
