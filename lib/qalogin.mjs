// lib/qalogin.mjs — motor de login QA data-driven (specs/004-qa-login). Convierte un contrato de
// login (URL/método/credenciales/campo del token) + credenciales en un token, para que el agente QA
// pruebe endpoints protegidos sin que el humano pegue un JWT. Puro y sin red (fetchImpl inyectable);
// NO conoce ningún endpoint de ninguna app: todo sale del contrato. Las credenciales no se persisten.

import { redactSensitiveText, safeUrlForDisplay } from './redact.mjs';

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
export function validateLoginEndpoint(value, { baseUrl, allowExternal = false } = {}) {
  let endpoint;
  try { endpoint = new URL(String(value || '')); }
  catch { throw new Error('login QA: URL inválida'); }
  if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error('login QA: protocolo no permitido');
  if (endpoint.username || endpoint.password) throw new Error('login QA: la URL no puede incluir credenciales');
  if (!baseUrl && !allowExternal) throw new Error('login QA: falta el origen de la aplicación para validar el endpoint');
  if (baseUrl && !allowExternal) {
    let base;
    try { base = new URL(String(baseUrl)); }
    catch { throw new Error('login QA: origen de la aplicación inválido'); }
    const loopback = new Set(['localhost', '127.0.0.1', '::1']);
    const bothLoopback = loopback.has(endpoint.hostname) && loopback.has(base.hostname);
    if (endpoint.origin !== base.origin && !bothLoopback) throw new Error(`login QA: el endpoint debe pertenecer al origen de la app (${base.origin})`);
  }
  if (allowExternal && endpoint.protocol !== 'https:' && endpoint.hostname !== 'localhost' && endpoint.hostname !== '127.0.0.1' && endpoint.hostname !== '::1') {
    throw new Error('login QA: un endpoint externo debe usar HTTPS');
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
export async function performLogin(config, credentials, { fetchImpl = fetch, baseUrl, allowExternal = false } = {}) {
  const req = buildLoginRequest(config, credentials);
  const endpoint = validateLoginEndpoint(req.url, { baseUrl, allowExternal });
  const displayUrl = safeUrlForDisplay(endpoint);
  let res;
  try {
    res = await fetchImpl(endpoint.toString(), { method: req.method, headers: req.headers, body: req.body, redirect: 'error' });
  } catch (e) {
    throw new Error(`login QA: no se pudo contactar ${displayUrl} (${redactSensitiveText(e?.message || e)})`);
  }
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 200); } catch { /* sin cuerpo legible */ }
    throw new Error(`login QA: el endpoint respondió HTTP ${res.status}${detail ? ` — ${redactSensitiveText(detail)}` : ''}`);
  }
  let json;
  try { json = await res.json(); } catch { throw new Error('login QA: la respuesta del login no es JSON'); }
  const token = extractToken(json, config.tokenPath);
  if (!token) throw new Error(`login QA: no encontré el token en la respuesta (campo esperado: ${config.tokenPath})`);
  return String(token);
}
