// cli/mcp/httpclient.mjs — cliente MCP REMOTO por Streamable HTTP, nativo y sin dependencias.
// Transporte estándar para servidores MCP alojados en internet (spec 2025-03-26): cada mensaje JSON-RPC
// va por POST al MISMO endpoint; la respuesta llega como application/json o como text/event-stream (SSE).
// La sesión la mantiene el header Mcp-Session-Id que el server devuelve en initialize. Misma interfaz que
// createStdioClient (start/listTools/callTool/stop), así astools no distingue local de remoto.
// Config del .mcp.json: { "url": "https://...", "headers": { "Authorization": "Bearer ${VAR}" } } —
// las referencias ${VAR} ya llegan resueltas desde el entorno (cli/project.mjs).

const PROTOCOL_VERSION = '2025-03-26';
const CLIENT_INFO = { name: 'chalc-cli', version: '0.1.0' };

// Extrae de un cuerpo SSE la respuesta JSON-RPC correlacionada con `id` (eventos "data: {...}").
function sseResponse(text, id) {
  for (const chunk of String(text).split(/\r?\n\r?\n/)) {
    const data = chunk.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
    if (!data) continue;
    try {
      const msg = JSON.parse(data);
      if (msg.id === id) return msg;
    } catch { /* evento no-JSON (comentario/latido): se ignora */ }
  }
  return null;
}

export function createHttpClient({ url, headers = {}, timeoutMs = 15000, fetchImpl } = {}) {
  if (!url) throw new Error('MCP HTTP: falta "url" en la configuración del servidor.');
  const doFetch = fetchImpl || fetch;
  let sessionId = null;
  let nextId = 1;

  async function post(message, { expectResponse = true, timeoutMs: limit } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), limit || timeoutMs);
    timer.unref?.();
    let res;
    try {
      res = await doFetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': PROTOCOL_VERSION,
          ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
          ...headers
        },
        body: JSON.stringify(message)
      });
    } catch (e) {
      throw new Error(`MCP HTTP: no se pudo contactar ${url} (${e?.name === 'AbortError' ? 'timeout' : e?.message || e})`);
    } finally {
      clearTimeout(timer);
    }
    const sid = res.headers?.get?.('mcp-session-id');
    if (sid) sessionId = sid;
    if (!res.ok) throw new Error(`MCP HTTP ${res.status} de ${url}`);
    if (!expectResponse || res.status === 202) return null;
    const ctype = res.headers?.get?.('content-type') || '';
    if (ctype.includes('text/event-stream')) {
      const msg = sseResponse(await res.text(), message.id);
      if (!msg) throw new Error('MCP HTTP: el stream SSE no trajo respuesta para el request');
      return msg;
    }
    return res.json();
  }

  async function request(method, params, opts) {
    const id = nextId++;
    const msg = await post({ jsonrpc: '2.0', id, method, params }, opts);
    if (msg?.error) throw new Error(msg.error.message || `error JSON-RPC ${msg.error.code ?? ''}`.trim());
    return msg?.result;
  }

  return {
    async start() {
      await request('initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO });
      await post({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }, { expectResponse: false });
    },
    async listTools() {
      const r = await request('tools/list', {});
      return r?.tools || [];
    },
    async callTool(name, args) {
      // Timeout largo: igual que en stdio, un tool remoto puede ejecutar operaciones lentas.
      return request('tools/call', { name, arguments: args || {} }, { timeoutMs: 60000 });
    },
    async stop() {
      // Cierre de sesión best-effort (DELETE con el session id); los servers sin sesión lo ignoran.
      if (!sessionId) return;
      try { await doFetch(url, { method: 'DELETE', headers: { 'mcp-session-id': sessionId, ...headers } }); } catch { /* best-effort */ }
    }
  };
}
