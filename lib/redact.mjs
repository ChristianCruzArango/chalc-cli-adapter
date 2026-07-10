// Redacción defensiva reutilizable para trazas, QA y salidas de herramientas externas.
// No pretende validar credenciales: evita que valores habituales lleguen a consola, artefactos o prompts.

const AUTHORIZATION_VALUE_RE = /(\b(?:authorization|proxy-authorization)\b\s*[:=]\s*)(?:(?:bearer|basic|token)\s+)?[^\s"',\r\n}]+/gi;
const SENSITIVE_VALUE_RE = /("?(?:token|access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|password|secret|credential|client[_-]?secret|private[_-]?key)"?\s*[:=]\s*["']?)([^"',\s}&]+)/gi;
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const BASIC_RE = /\bBasic\s+[A-Za-z0-9+/=]+/gi;
const JWT_RE = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const API_KEY_PATTERNS = [
  /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{12,}\b/g,
  /\b(?:sk|pk|rk|ghp|github_pat)_[A-Za-z0-9_=-]{12,}\b/g,
  /\bglpat-[A-Za-z0-9_-]{12,}\b/g,
  /\bxox(?:b|p|a|r|s)-[A-Za-z0-9-]{12,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}\b/g
];

export function redactSensitiveText(value) {
  let text = String(value ?? '')
    .replace(AUTHORIZATION_VALUE_RE, '$1[REDACTED]')
    .replace(BEARER_RE, 'Bearer [REDACTED]')
    .replace(BASIC_RE, 'Basic [REDACTED]')
    .replace(JWT_RE, '[REDACTED_JWT]')
    .replace(SENSITIVE_VALUE_RE, '$1[REDACTED]');
  for (const pattern of API_KEY_PATTERNS) text = text.replace(pattern, '[REDACTED_KEY]');
  return text;
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
