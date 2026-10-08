// lib/qalogin.mjs — motor de login QA data-driven (specs/004-qa-login). Convierte un contrato de
// login (URL/método/credenciales/campo del token) + credenciales en un token, para que el agente QA
// pruebe endpoints protegidos sin que el humano pegue un JWT. Puro y sin red (fetchImpl inyectable);
// NO conoce ningún endpoint de ninguna app: todo sale del contrato. Las credenciales no se persisten.

import { redactSensitiveText, safeUrlForDisplay } from './redact.mjs';
import { fetchWithTimeout } from './net.mjs';
import { t } from './i18n.mjs';

const LOGIN_TIMEOUT_MS = 30000;
const timedFetch = (url, init) => fetchWithTimeout(url, { ...init, timeoutMs: LOGIN_TIMEOUT_MS });

// Contrato efectivo: el de la spec (inputs.login) pisa el del proyecto (.chalc.json qa.login). (R1)
export function resolveLoginConfig(chalcJson, inputs) {
  return inputs?.login || chalcJson?.qa?.login || null;
}

// Campos de credencial declarados, normalizados. `secret` → prompt oculto / nunca se imprime. (R2)
export function loginFields(config) {
  return (config?.fields || []).map((f) => ({
    name: String(f.name),
    label: String(f.label || f.name),
    default: f.default != null ? String(f.default) : '',
    secret: !!f.secret
  }));
}

// Reemplaza ${campo} en cualquier string, recorriendo objetos/arrays anidados. (R4)
export function interpolate(template, values) {
  if (typeof template === 'string') {
    return template.replace(/\$\{(\w+)\}/g, (_, k) => (values[k] != null ? String(values[k]) : ''));
  }
  if (Array.isArray(template)) return template.map((t) => interpolate(t, values));
  if (template && typeof template === 'object') {
    return Object.fromEntries(Object.entries(template).map(([k, v]) => [k, interpolate(v, values)]));
  }
  return template;
}

// Arma la petición de login: query → querystring codificada en la URL; body → JSON con content-type. (R4)
export function buildLoginRequest(config, credentials) {
  const method = String(config.method || 'POST').toUpperCase();
  let url = String(config.url || '');
  const query = interpolate(config.query || {}, credentials);
  const qs = Object.entries(query).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  if (qs) url += (url.includes('?') ? '&' : '?') + qs;
  const headers = interpolate(config.headers || {}, credentials);
  const req = { url, method, headers };
  if (config.body != null) {
    req.headers = { 'content-type': 'application/json', ...headers };
    req.body = JSON.stringify(interpolate(config.body, credentials));
  }
  return req;
}

// Resumen seguro para confirmar el destino ANTES de solicitar secretos al usuario.
export function loginEndpointPreview(config) {
  return { method: String(config?.method || 'POST').toUpperCase(), url: safeUrlForDisplay(config?.url) };
}

// El contrato de login pertenece al proyecto, así que no puede elegir libremente dónde enviar credenciales.
// Por defecto debe ser el mismo origen que la app QA ya levantada; un proveedor externo solo se permite
// cuando el usuario lo autorizó explícitamente. Los redirects se rechazan en performLogin.
// `URL.hostname` da las IPv6 ENTRE CORCHETES (`[::1]`): compararlo con '::1' nunca acertaba.
const isLoopback = (hostname) => {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host);
};

export function validateLoginEndpoint(value, { baseUrl, allowExternal = false } = {}) {
  let endpoint;
  try { endpoint = new URL(String(value || '')); }
  catch { throw new Error(t('loginBadUrl')); }
  if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error(t('loginBadProtocol'));
  if (endpoint.username || endpoint.password) throw new Error(t('loginUrlCredentials'));
  if (!baseUrl && !allowExternal) throw new Error(t('loginNoOrigin'));
  if (baseUrl && !allowExternal) {
    let base;
    try { base = new URL(String(baseUrl)); }
    catch { throw new Error(t('loginBadOrigin')); }
    // Front y API en puertos distintos de la misma máquina es lo normal en desarrollo (4200 y 3000):
    // entre direcciones de loopback se acepta otro puerto, pero con el mismo esquema.
    const bothLoopback = isLoopback(endpoint.hostname) && isLoopback(base.hostname) && endpoint.protocol === base.protocol;
    if (endpoint.origin !== base.origin && !bothLoopback) throw new Error(t('loginForeignOrigin', base.origin));
  }
  if (allowExternal && endpoint.protocol !== 'https:' && !isLoopback(endpoint.hostname)) {
    throw new Error(t('loginNeedsHttps'));
  }
  return endpoint;
}

// Navega un objeto por una ruta con puntos ("datos.token"); null si algún tramo falta. (R4/R6)
export function extractToken(json, tokenPath) {
  return String(tokenPath || '').split('.').reduce((acc, key) => (acc && acc[key] != null ? acc[key] : null), json);
}

// Hace el login y devuelve el token. Lanza Error con motivo claro si el HTTP falla, la respuesta no es
// JSON o el tokenPath no aparece — para que el comando aborte el agente en vez de mandar peticiones
// sin auth. (R4/R6) Nunca imprime credenciales.
export async function performLogin(config, credentials, { fetchImpl = timedFetch, baseUrl, allowExternal = false } = {}) {
  const req = buildLoginRequest(config, credentials);
  const endpoint = validateLoginEndpoint(req.url, { baseUrl, allowExternal });
  const displayUrl = safeUrlForDisplay(endpoint);
  let res;
  try {
    res = await fetchImpl(endpoint.toString(), { method: req.method, headers: req.headers, body: req.body, redirect: 'error' });
  } catch (e) {
    throw new Error(t('loginUnreachable', displayUrl, redactSensitiveText(e?.message || e)));
  }
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 200); } catch { /* sin cuerpo legible */ }
    throw new Error(t('loginHttpStatus', res.status, detail ? redactSensitiveText(detail) : ''));
  }
  let json;
  try { json = await res.json(); } catch { throw new Error(t('loginNotJson')); }
  const token = extractToken(json, config.tokenPath);
  if (!token) throw new Error(t('loginNoToken', config.tokenPath));
  return String(token);
}
