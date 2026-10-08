// lib/sources.mjs — trae el texto de una HU desde una fuente remota (Azure DevOps, Jira, Drive/URL).
// Sin dependencias: usa fetch nativo. Los archivos locales los maneja docread.mjs.

import { assertPublicUrl, fetchWithTimeout, publicFetch, readLimitedText } from './net.mjs';
import { t } from './i18n.mjs';
import { tokens } from './markup.mjs';

const MAX_REDIRECTS = 5;
const SOURCE_TIMEOUT_MS = 30000;
const SOURCE_MAX_BYTES = 2 * 1024 * 1024;

const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" };

const BLOCK_END = new Set(['p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr']);

// Lo que deja cada etiqueta en el texto plano. Recorrido lineal (`tokens`): las expresiones
// `<[^>]+>` eran cuadráticas con HTML sin cerrar, y este texto llega de una URL ajena.
function tagText(tag, next) {
  const closing = tag[0] === '/';
  const name = (closing ? tag.slice(1) : tag).trim().split(/[\s/]/)[0].toLowerCase();
  if (closing) return BLOCK_END.has(name) ? '\n' : '';
  if (name === 'br') return next?.startsWith('\n') ? '' : '\n';
  return name === 'li' ? '- ' : '';
}

export function stripHtml(html) {
  if (!html) return '';
  const list = [...tokens(String(html))];
  return list.map((tk, i) => (tk.text !== undefined ? tk.text : tagText(tk.tag, list[i + 1]?.text))).join('')
    // UNA sola pasada: decodificar `&amp;` antes que el resto convertía `&amp;lt;` (el texto literal
    // «&lt;») en `<`.
    .replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (m, name) => ENTITIES[name])
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function fetchExternalText(url, fetchImpl) {
  let current = await assertPublicUrl(url);
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const res = await fetchWithTimeout(current, { fetchImpl, redirect: 'manual', timeoutMs: SOURCE_TIMEOUT_MS });
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get('location');
      if (!location) throw new Error(t('srcRedirectNoLocation', current));
      current = await assertPublicUrl(new URL(location, current).toString());   // revalida cada salto
      continue;
    }
    if (!res.ok) throw new Error(`URL ${res.status}: ${current}`);
    const text = await readLimitedText(res, SOURCE_MAX_BYTES);
    const ct = res.headers.get('content-type') || '';
    return ct.includes('html') ? stripHtml(text) : text.trim();
  }
  throw new Error(t('srcTooManyRedirects', url));
}

// Extrae texto plano de un documento ADF (Atlassian Document Format) de Jira.
function adfToText(node) {
  if (!node || typeof node !== 'object') return '';
  let out = node.text || '';
  if (Array.isArray(node.content)) out += node.content.map(adfToText).join('');
  if (['paragraph', 'heading', 'listItem', 'tableRow'].includes(node.type)) out += '\n';
  return out;
}

// Azure DevOps y Jira NO responden 401 cuando el token es inválido: redirigen al login y devuelven
// HTML con un status que `res.ok` acepta (203/200). Sin este control, res.json() reventaba con
// "Unexpected token '<'" y el usuario no tenía forma de saber que el problema era el token.
async function readJsonBody(res, who) {
  const body = (await readLimitedText(res, SOURCE_MAX_BYTES)).trim();
  if (body.startsWith('<')) throw new Error(t('srcNotJson', who, res.status));
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(t('srcBadJson', who, res.status));
  }
}

// 401/403 son el rechazo explícito. El 203 con HTML (redirección al login) lo diagnostica readJsonBody,
// que puede decir algo más concreto: "respondió la página de login".
function assertAuthorized(res, who) {
  if ([401, 403].includes(res.status)) throw new Error(t('srcAuthFailed', who, res.status));
}

// Azure DevOps: URL del work item + PAT → título + descripción + criterios de aceptación.
// `fetchImpl` es `publicFetch` (IP validada en la propia conexión) salvo en las pruebas. Los conectores
// con credenciales NO siguen redirecciones: el token no puede viajar a un destino que no se validó.
export async function fetchAzureDevOps({ url, pat }, { fetchImpl = publicFetch } = {}) {
  const org = (url.match(/dev\.azure\.com\/([^/]+)/) || url.match(/https?:\/\/([^.]+)\.visualstudio\.com/) || [])[1];
  const id = (url.match(/_workitems\/edit\/(\d+)/) || url.match(/[?&]workitem=(\d+)/) || url.match(/\/(\d+)(?:[/?#]|$)/) || [])[1];
  if (!org || !id) throw new Error(t('srcAzureBadUrl'));
  const api = `https://dev.azure.com/${encodeURIComponent(org)}/_apis/wit/workitems/${encodeURIComponent(id)}?api-version=7.0`;
  await assertPublicUrl(api);   // misma invariante que Jira/URL: todo fetch externo pasa por el validador SSRF
  const res = await fetchWithTimeout(api, {
    fetchImpl,
    redirect: 'error',
    timeoutMs: SOURCE_TIMEOUT_MS,
    headers: {
      // El PAT se pega a mano: los espacios/saltos de línea del portapapeles rompen el Basic auth.
      authorization: 'Basic ' + Buffer.from(':' + String(pat || '').trim()).toString('base64'),
      accept: 'application/json',
      'x-tfs-fedauthredirect': 'Suppress'   // pide un 401 limpio en vez del HTML del login
    }
  });
  assertAuthorized(res, 'Azure DevOps');
  if (!res.ok) throw new Error(`Azure DevOps ${res.status}: ${(await readLimitedText(res)).slice(0, 300)}`);
  const f = (await readJsonBody(res, 'Azure DevOps')).fields || {};
  return [
    f['System.Title'] && `# ${f['System.Title']}`,
    f['System.Description'] && stripHtml(f['System.Description']),
    f['Microsoft.VSTS.Common.AcceptanceCriteria'] && '## Criterios de aceptación\n' + stripHtml(f['Microsoft.VSTS.Common.AcceptanceCriteria'])
  ].filter(Boolean).join('\n\n');
}

// Jira: URL del issue + email + API token → summary + descripción.
export async function fetchJira({ url, email, token }, { fetchImpl = publicFetch } = {}) {
  const site = (url.match(/https?:\/\/([^/]+)/) || [])[1];
  const key = (url.match(/([A-Z][A-Z0-9]+-\d+)/) || [])[1];
  if (!site || !key) throw new Error(t('srcJiraBadUrl'));
  const api = `https://${site}/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary,description`;
  await assertPublicUrl(api);
  const res = await fetchWithTimeout(api, { fetchImpl, redirect: 'error', timeoutMs: SOURCE_TIMEOUT_MS, headers: { authorization: 'Basic ' + Buffer.from(`${String(email || '').trim()}:${String(token || '').trim()}`).toString('base64'), accept: 'application/json' } });
  assertAuthorized(res, 'Jira');
  if (!res.ok) throw new Error(`Jira ${res.status}: ${(await readLimitedText(res)).slice(0, 300)}`);
  const f = (await readJsonBody(res, 'Jira')).fields || {};
  return [f.summary && `# ${f.summary}`, adfToText(f.description).trim()].filter(Boolean).join('\n\n');
}

// Google Drive (Doc/Sheet compartido por enlace) o cualquier URL http que devuelva texto.
export async function fetchUrl(url, { fetchImpl = publicFetch } = {}) {
  let target = url;
  const gdoc = url.match(/docs\.google\.com\/document\/d\/([\w-]+)/);
  const gsheet = url.match(/docs\.google\.com\/spreadsheets\/d\/([\w-]+)/);
  if (gdoc) target = `https://docs.google.com/document/d/${gdoc[1]}/export?format=txt`;
  else if (gsheet) target = `https://docs.google.com/spreadsheets/d/${gsheet[1]}/export?format=csv`;
  return fetchExternalText(target, fetchImpl);
}
