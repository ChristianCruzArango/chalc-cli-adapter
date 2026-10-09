import { isIP, BlockList } from 'node:net';
import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { Readable } from 'node:stream';
import { t } from './i18n.mjs';

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

export function externalHttpUrl(input) {
  let url;
  try {
    url = new URL(String(input));
  } catch {
    throw new Error(t('netBadUrl', input));
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(t('netBadProtocol', url.protocol));
  assertPublicHost(url.hostname);
  return url;
}

// ── clasificación de IPs ──────────────────────────────────────────────────────────────────────
// Se trabaja sobre BYTES, no sobre el texto: `new URL()` normaliza `[::ffff:127.0.0.1]` a
// `[::ffff:7f00:1]`, y una comparación de cadenas deja de reconocerla. Toda forma IPv6 que lleva una
// IPv4 dentro (mapeada, compatible, NAT64, SIIT, 6to4) se juzga por la IPv4 que lleva.

const V4_BLOCKED = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]
]) V4_BLOCKED.addSubnet(net, prefix, 'ipv4');

const V6_BLOCKED = new BlockList();
for (const [net, prefix] of [
  ['::', 128], ['::1', 128], ['100::', 64], ['64:ff9b:1::', 48], ['2001::', 32], ['2001:10::', 28],
  ['2001:20::', 28], ['2001:db8::', 32], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8]
]) V6_BLOCKED.addSubnet(net, prefix, 'ipv6');

// Los 16 bytes de una IPv6 en cualquiera de sus escrituras (`::`, cola decimal, zona `%eth0`).
function ipv6Bytes(text) {
  let host = text.split('%')[0];
  let tail = null;
  const dotted = host.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) { tail = dotted[2].split('.').map(Number); host = `${dotted[1]}0:0`; }
  const [head, rest] = host.includes('::') ? host.split('::') : [host, null];
  const left = head ? head.split(':') : [];
  const right = rest ? rest.split(':') : [];
  const groups = [...left, ...Array(rest === null ? 0 : 8 - left.length - right.length).fill('0'), ...right];
  const bytes = groups.flatMap((g) => { const n = parseInt(g, 16); return [n >> 8, n & 0xff]; });
  if (tail) bytes.splice(12, 4, ...tail);
  return bytes;
}

const startsWith = (bytes, prefix) => prefix.every((b, i) => bytes[i] === b);
const v4At = (bytes, at) => bytes.slice(at, at + 4).join('.');
const ZERO10 = Array(10).fill(0);

// La IPv4 que va dentro de una IPv6, o null si no lleva ninguna.
function embeddedIpv4(bytes) {
  if (startsWith(bytes, [...ZERO10, 0xff, 0xff])) return v4At(bytes, 12);                       // ::ffff:0:0/96 mapeada
  if (startsWith(bytes, [...ZERO10, 0, 0])) return v4At(bytes, 12);                              // ::/96 compatible
  if (startsWith(bytes, [0, 0x64, 0xff, 0x9b, ...ZERO10.slice(0, 8)])) return v4At(bytes, 12);   // 64:ff9b::/96 NAT64
  if (startsWith(bytes, [0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff, 0, 0])) return v4At(bytes, 12);     // ::ffff:0:0:0/96 SIIT
  if (startsWith(bytes, [0x20, 0x02])) return v4At(bytes, 2);                                    // 2002::/16 6to4
  return null;
}

// Rechaza una IP literal (v4 o v6) que no sea de Internet pública: loopback, privada, CGNAT,
// link-local, no especificada, documentación, multicast o reservada.
export function assertPublicIp(address) {
  const host = String(address || '').toLowerCase().replace(/^\[|\]$/g, '');
  const ipKind = isIP(host.split('%')[0]);
  if (ipKind === 4) {
    if (V4_BLOCKED.check(host, 'ipv4')) throw new Error(t('netPrivateIp'));
    return;
  }
  if (ipKind === 6) {
    const bytes = ipv6Bytes(host);
    const inner = embeddedIpv4(bytes);
    if (inner) { assertPublicIp(inner); return; }
    const canonical = bytes.reduce((acc, b, i) => acc + (i % 2 ? b.toString(16).padStart(2, '0') : (i ? ':' : '') + b.toString(16).padStart(2, '0')), '');
    if (V6_BLOCKED.check(canonical, 'ipv6')) throw new Error(t('netPrivateIpv6'));
  }
}

export function assertPublicHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) throw new Error(t('netNoHost'));
  if (host === 'localhost' || host.endsWith('.localhost')) throw new Error(t('netLocalHost'));
  if (isIP(host)) assertPublicIp(host);
}

// Guard SSRF completo para URLs de origen no confiable: además del host literal, resuelve el DNS
// y valida TODAS las IPs resueltas. Cierra el caso "dominio público que resuelve a 127.0.0.1 / 169.254.169.254".
// Nota: queda un TOCTOU residual (el resolver de fetch repite la resolución); aceptable para un CLI local.
export async function assertPublicUrl(input) {
  const url = externalHttpUrl(input);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) return url;   // IP literal: ya validada por externalHttpUrl
  let addresses;
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error(t('netUnresolvable', host));
  }
  if (!addresses.length) throw new Error(t('netNoAddresses', host));
  for (const a of addresses) assertPublicIp(a.address);
  return url;
}

// ── fetch hacia destinos no confiables ────────────────────────────────────────────────────────
// Validar el DNS y después llamar a `fetch` deja una ventana: `fetch` vuelve a resolver el nombre y
// un servidor DNS hostil puede contestar otra IP la segunda vez (DNS rebinding). Aquí la validación
// va DENTRO del `lookup` de la conexión: la IP que se comprueba es exactamente la IP a la que se
// conecta. Las redirecciones se revalidan salto a salto y, si cambian de origen, pierden las
// credenciales.

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;
const CREDENTIAL_HEADERS = new Set(['authorization', 'cookie', 'proxy-authorization']);

export function guardedLookup(hostname, options, callback) {
  lookup(hostname, { all: true, verbatim: true })
    .then((addresses) => {
      if (!addresses.length) throw new Error(t('netNoAddresses', hostname));
      for (const a of addresses) assertPublicIp(a.address);
      if (options?.all) callback(null, addresses);
      else callback(null, addresses[0].address, addresses[0].family);
    })
    .catch((err) => callback(err));
}

const plainHeaders = (headers) => (headers instanceof Headers ? Object.fromEntries(headers) : { ...(headers || {}) });

function requestOnce(url, { method = 'GET', headers, body, signal }) {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(url, { method, headers: plainHeaders(headers), signal, lookup: guardedLookup }, (res) => {
      const out = new Headers();
      for (let i = 0; i < res.rawHeaders.length; i += 2) {
        try { out.append(res.rawHeaders[i], res.rawHeaders[i + 1]); } catch { /* cabecera ilegible: se descarta */ }
      }
      const empty = method === 'HEAD' || [204, 205, 304].includes(res.statusCode);
      if (empty) res.resume();
      resolve(new Response(empty ? null : Readable.toWeb(res), { status: res.statusCode, statusText: res.statusMessage, headers: out }));
    });
    req.on('error', reject);
    req.end(body ?? undefined);
  });
}

// `fetch` acotado a Internet pública, con la misma forma de llamada y de respuesta. `redirect`
// admite 'follow' (por defecto), 'manual' y 'error', como `fetch`.
export async function publicFetch(input, opts = {}) {
  let url = externalHttpUrl(input);
  let request = { ...opts, headers: plainHeaders(opts.headers) };
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await requestOnce(url, request);
    if (!REDIRECTS.has(res.status) || request.redirect === 'manual') return res;
    await res.body?.cancel();
    if (request.redirect === 'error') throw new Error(t('netRedirect', url.origin));
    const location = res.headers.get('location');
    if (!location) return res;
    const next = externalHttpUrl(new URL(location, url));
    if (next.origin !== url.origin) {
      request.headers = Object.fromEntries(Object.entries(request.headers).filter(([k]) => !CREDENTIAL_HEADERS.has(k.toLowerCase())));
    }
    if (res.status === 303 || ([301, 302].includes(res.status) && request.method === 'POST')) {
      request = { ...request, method: 'GET', body: undefined };
    }
    url = next;
  }
  throw new Error(t('netTooManyRedirects', input));
}

// Une la señal del llamador (cancelación) con la del plazo: la que llegue primero corta.
function anySignal(signals) {
  const live = signals.filter(Boolean);
  if (live.length < 2) return live[0];
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(live);
  const controller = new AbortController();
  for (const s of live) {
    if (s.aborted) { controller.abort(s.reason); break; }
    s.addEventListener('abort', () => controller.abort(s.reason), { once: true });
  }
  return controller.signal;
}

// `fetch` con plazo para TODA la respuesta, cuerpo incluido. Antes el plazo se cancelaba al llegar
// las cabeceras: un servidor que las manda y retrasa el cuerpo dejaba `res.text()` esperando sin
// límite. Ahora el temporizador vive hasta que el cuerpo se termina de leer (o se cancela), y una
// `signal` del llamador se suma al plazo en vez de sustituirlo.
export async function fetchWithTimeout(url, opts = {}) {
  const { fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS, signal, ...init } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  let res;
  try {
    res = await fetchImpl(url, { ...init, signal: anySignal([signal, controller.signal]) });
  } catch (e) {
    clearTimeout(timer);
    if (e?.name === 'AbortError' || e?.name === 'TimeoutError') throw new Error(t('netTimeout', url));
    throw e;
  }
  if (!res?.body || typeof res.body.pipeThrough !== 'function') { clearTimeout(timer); return res; }
  const body = res.body.pipeThrough(new TransformStream({ flush() { clearTimeout(timer); } }));
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

export async function readLimitedText(res, maxBytes = DEFAULT_MAX_BYTES) {
  const length = Number(res.headers?.get?.('content-length') || 0);
  if (length && length > maxBytes) throw new Error(t('netTooLarge', length, maxBytes));
  if (!res.body) return res.text();

  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) throw new Error(t('netTooLargeStream', maxBytes));
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
