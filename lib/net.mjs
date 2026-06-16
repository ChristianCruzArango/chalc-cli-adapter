import { isIP } from 'node:net';

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

export function externalHttpUrl(input) {
  let url;
  try {
    url = new URL(String(input));
  } catch {
    throw new Error(`URL inválida: ${input}`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`Protocolo no permitido: ${url.protocol}`);
  assertPublicHost(url.hostname);
  return url;
}

export function assertPublicHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) throw new Error('URL sin host');
  if (host === 'localhost' || host.endsWith('.localhost')) throw new Error('Host local no permitido');

  const ipKind = isIP(host);
  if (ipKind === 4) {
    const parts = host.split('.').map(Number);
    const [a, b] = parts;
    if (a === 10 || a === 127 || a === 0) throw new Error('IP privada/local no permitida');
    if (a === 169 && b === 254) throw new Error('IP link-local no permitida');
    if (a === 172 && b >= 16 && b <= 31) throw new Error('IP privada no permitida');
    if (a === 192 && b === 168) throw new Error('IP privada no permitida');
  }
  if (ipKind === 6) {
    if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) {
      throw new Error('IPv6 local/privada no permitida');
    }
  }
}

export async function fetchWithTimeout(url, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: opts.signal || controller.signal });
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error(`Timeout al conectar con ${url}`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function readLimitedText(res, maxBytes = DEFAULT_MAX_BYTES) {
  const length = Number(res.headers.get('content-length') || 0);
  if (length && length > maxBytes) throw new Error(`Respuesta demasiado grande (${length} bytes, máximo ${maxBytes})`);
  if (!res.body) return res.text();

  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) throw new Error(`Respuesta demasiado grande (máximo ${maxBytes} bytes)`);
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(out);
}
