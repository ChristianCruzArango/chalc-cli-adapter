// Redacción defensiva reutilizable para trazas, QA y salidas de herramientas externas.
// No pretende validar credenciales: evita que valores habituales lleguen a consola, artefactos o prompts.
//
// Dos niveles, porque redactar de más también rompe:
//   - redactKnownSecrets: solo lo inconfundible (JWT, prefijos de API keys, bloques PEM, credenciales en
//     una URL, Bearer/Basic largos). Se aplica a TODO lo que ve el modelo, código incluido.
//   - redactSensitiveText: además, todo `clave = valor` con nombre sensible. Es lo correcto para un
//     `.env`, una respuesta HTTP o la salida de un MCP, pero NO para código: `const token = getToken()`
//     quedaría `token = [REDACTED]`, y un modelo que edita a partir de eso escribiría basura.

// `clave = valor` (también `"clave": "valor"`). Solo se intenta al inicio de un identificador, así cada
// intento recorre un único nombre y el conjunto sigue siendo lineal.
const KEY_VALUE_RE = /(?<![A-Za-z0-9_-])(["']?)([A-Za-z][A-Za-z0-9_-]*)\1(\s*[:=]\s*)("(?:[^"\\\r\n]|\\.)*"|'(?:[^'\\\r\n]|\\.)*'|[^"',\s}&;]+)/g;
const SENSITIVE_WORDS = new Set(['token', 'password', 'passwd', 'pwd', 'pass', 'secret', 'secrets', 'credential', 'credentials']);
const SENSITIVE_JOINED = /(apikey|privatekey|sessionid|accesskey|clientsecret)/;

// ¿El identificador nombra un secreto? Se parte en palabras (`_`, `-`, camelCase): `DB_PASS`,
// `stripeSecret` y `api_key` lo son; `bypass` y `passport` no, porque «pass» no es una palabra suya.
function isSensitiveName(name) {
  const words = name.split(/[_-]|(?<=[a-z0-9])(?=[A-Z])/).map((w) => w.toLowerCase()).filter(Boolean);
  return words.some((w) => SENSITIVE_WORDS.has(w)) || SENSITIVE_JOINED.test(words.join(''));
}

const AUTHORIZATION_VALUE_RE = /(\b(?:authorization|proxy-authorization)\b\s*[:=]\s*)(?:(?:bearer|basic|token)\s+)?[^\s"',\r\n}]+/gi;
const COOKIE_RE = /(\b(?:set-)?cookie\s*:\s*)[^\r\n]+/gi;
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const BASIC_RE = /\bBasic\s+[A-Za-z0-9+/=]+/gi;
// En código y prosa, «Bearer» y «Basic» van seguidos de palabras normales: solo un valor largo es un secreto.
const LONG_BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/g;
const LONG_BASIC_RE = /\bBasic\s+[A-Za-z0-9+/]{16,}={0,2}/g;
const JWT_RE = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const PEM_BEGIN = /-----BEGIN [A-Z ]{0,40}PRIVATE KEY-----/g;
const PEM_END = 'PRIVATE KEY-----';
// Solo se intenta al inicio de un esquema (`(?<!…)`): con `\b`, cada punto de `a.a.a…` abría un intento nuevo.
const URL_CREDENTIALS_RE = /(?<![a-z0-9+.-])([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi;
const API_KEY_PATTERNS = [
  /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{12,}\b/g,
  /\b(?:sk|pk|rk|ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_=-]{12,}\b/g,
  /\bglpat-[A-Za-z0-9_-]{12,}\b/g,
  /\bxox(?:b|p|a|r|s)-[A-Za-z0-9-]{12,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}\b/g,
  /\bnpm_[A-Za-z0-9]{30,}\b/g
];

// Mantiene las comillas del valor: un JSON redactado sigue siendo JSON.
const masked = (value) => (/^["']/.test(value) ? `${value[0]}[REDACTED]${value[0]}` : '[REDACTED]');

// Bloques PEM de clave privada, buscados con indexOf: un BEGIN sin END corta el recorrido (lineal).
function redactPem(text) {
  const out = [];
  let i = 0;
  PEM_BEGIN.lastIndex = 0;
  for (let m = PEM_BEGIN.exec(text); m; m = PEM_BEGIN.exec(text)) {
    const endMarker = text.indexOf('-----END ', m.index + m[0].length);
    const end = endMarker < 0 ? -1 : text.indexOf(PEM_END, endMarker);
    if (end < 0) break;
    out.push(text.slice(i, m.index), '[REDACTED_PRIVATE_KEY]');
    i = end + PEM_END.length;
    PEM_BEGIN.lastIndex = i;
  }
  out.push(text.slice(i));
  return out.join('');
}

export function redactKnownSecrets(value) {
  let text = redactPem(String(value ?? ''))
    .replace(URL_CREDENTIALS_RE, '$1[REDACTED]@')
    .replace(LONG_BEARER_RE, 'Bearer [REDACTED]')
    .replace(LONG_BASIC_RE, 'Basic [REDACTED]')
    .replace(JWT_RE, '[REDACTED_JWT]');
  for (const pattern of API_KEY_PATTERNS) text = text.replace(pattern, '[REDACTED_KEY]');
  return text;
}

export function redactSensitiveText(value) {
  const text = redactKnownSecrets(value)
    .replace(AUTHORIZATION_VALUE_RE, '$1[REDACTED]')
    .replace(COOKIE_RE, '$1[REDACTED]')
    .replace(BEARER_RE, 'Bearer [REDACTED]')
    .replace(BASIC_RE, 'Basic [REDACTED]')
    .replace(KEY_VALUE_RE, (m, quote, name, sep, val) => (isSensitiveName(name) ? `${quote}${name}${quote}${sep}${masked(val)}` : m));
  return text;
}

// Archivos cuyo contenido ES una lista de secretos: se leen con la redacción completa.
const SECRET_FILE = /(^|[\\/])(\.env(\.[\w.-]+)?|\.npmrc|\.pypirc|\.netrc|\.git-credentials|credentials(\.json)?|secrets?\.(json|ya?ml|toml)|id_(rsa|dsa|ecdsa|ed25519)|[^\\/]+\.(pem|key|p12|pfx|keystore|jks))$/i;
export const isSecretFile = (path) => SECRET_FILE.test(String(path || ''));

// Formatos que la regla general `clave = valor` no ve (V-04): `.netrc` separa por ESPACIOS
// (`machine h login u password p`, también en varias líneas), y en `.npmrc` las claves de
// autenticación empiezan por `_` (`//registry/:_authToken=…`, `_auth=…`, `_password=…`).
const NETRC_RE = /(\b(?:login|password|account)\s+)\S+/g;
const NPMRC_RE = /^([^\S\r\n]*(?:\/\/\S*?:)?_(?:authToken|auth|password)\s*=\s*)[^\r\n]+/gim;
const FORMAT_REDACTORS = [['.netrc', NETRC_RE], ['.npmrc', NPMRC_RE]];
const basenameOf = (path) => String(path || '').split(/[\\/]/).pop().toLowerCase();

// Contenido de un archivo de credenciales, mirado por TODAS sus rutas (la pedida y la real: un enlace
// `notes.txt -> .env` es un `.env`). Si ninguna es de credenciales, el texto vuelve intacto.
export function redactSecretFile(text, paths = []) {
  const secret = paths.filter(isSecretFile).map(basenameOf);
  if (!secret.length) return text;
  return FORMAT_REDACTORS.reduce(
    (out, [name, re]) => (secret.includes(name) ? out.replace(re, '$1[REDACTED]') : out),
    redactSensitiveText(text)
  );
}

// Convierte una URL en texto seguro para UI y mensajes de error: nunca enseña credenciales, query ni fragment.
export function safeUrlForDisplay(value) {
  try {
    const url = new URL(String(value));
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return '[URL inválida]';
  }
}

// Aplica `redact` a cada cadena de una observación (objeto, array o texto), sin tocar su forma.
export function redactStrings(value, redact = redactKnownSecrets) {
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map((v) => redactStrings(v, redact));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactStrings(v, redact)]));
  return value;
}

// Los screenshots se pueden preservar para un artefacto local, pero no deben entrar al prompt por defecto.
export function redactObservation(value, { preserveScreenshots = false } = {}) {
  if (typeof value === 'string') return redactSensitiveText(value);
  if (Array.isArray(value)) return value.map((v) => redactObservation(v, { preserveScreenshots }));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => {
      if (/^screenshotBase64$/i.test(key)) return [key, preserveScreenshots ? item : '[REDACTED_SCREENSHOT]'];
      if (/(token|password|secret|authorization|api[_-]?key|credential|private[_-]?key)/i.test(key)) return [key, '[REDACTED]'];
      return [key, redactObservation(item, { preserveScreenshots })];
    }));
  }
  return value;
}
