// security-checks.mjs — las comprobaciones de la etapa de seguridad (spec 014, R2–R8).
// Responsabilidad ÚNICA: decir, para UNA línea ya limpia de comentarios, si tiene un patrón inseguro
// y cuál. Razón de cambio: qué se considera una señal de seguridad de alta confianza.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// Cada comprobación devuelve lo que la delató —un nombre, un host, un algoritmo— o null. Nunca el
// valor de un secreto: la evidencia lo copiaría a un segundo archivo. Quién lee el archivo, qué
// líneas son de la tarea y qué se suprime es de `security.mjs`.

import { isTestFile } from './sources.mjs';
import { RULES } from './rules.mjs';

export const extOf = (file) => (String(file).match(/\.[^./\\]+$/) || [''])[0].toLowerCase();

// ── hardcoded-secret (R2, R11) ────────────────────────────────────────────────────────────────

// Formas que solo tiene un secreto real, se llame como se llame la variable que lo guarda.
const KNOWN_SECRETS = [
  ['private key', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/],
  ['AWS access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['Stripe key', /\b[sr]k_live_[0-9A-Za-z]{16,}\b/],
  ['Slack token', /\bxox[abprs]-[0-9A-Za-z-]{10,}\b/]
];

// Un nombre que anuncia un secreto, asignado a un literal: `apiKey = "…"`, `clientSecret: "…"`,
// `"auth_token": "…"`, `String DB_PASSWORD = "…"`, `val accessKey: String = "…"`. El `=` no puede
// ir seguido de otro `=`: una comparación no guarda nada.
// `(?<![\w$])`: el intento solo empieza al INICIO de un identificador. Sin él, cada carácter de un
// identificador largo abría un intento que lo recorría entero (cuadrático: 6 s con 100 KB).
const ASSIGNED = /(?<![\w$])([A-Za-z_$][\w$]*)["']?\s*(?::\s*[A-Za-z_][\w<>?[\]]*\s*)?(?:=(?!=)|:)\s*(["'`])([^"'`]*)\2/g;
// El nombre se parte en palabras (`_`, `-`, camelCase) y se busca una palabra de secreto. Así `DB_PASS`
// cuenta —antes `pass` no estaba— y `bypass` o `passport` no, porque «pass» no es una palabra suya.
const SECRET_WORDS = new Set(['password', 'passwd', 'passphrase', 'pwd', 'pass', 'secret', 'token', 'credential', 'credentials']);
const SECRET_JOINED = /apikey|accesskey|privatekey|authkey|clientsecret/;
function secretName(name) {
  const words = String(name).split(/[_-]|(?<=[a-z0-9])(?=[A-Z])/).map((w) => w.toLowerCase()).filter(Boolean);
  return words.some((w) => SECRET_WORDS.has(w)) || SECRET_JOINED.test(words.join(''));
}

// `secret = process.env.X || "Abcdef12"`: el literal de respaldo también acaba en el repo. Cubre `||`,
// `??`, el `or` de Python y el segundo argumento de `getenv`/`environ.get`.
const FALLBACK = /(?<![\w$])([A-Za-z_$][\w$]*)["']?\s*(?::\s*[A-Za-z_][\w<>?[\]]*\s*)?(?:=(?!=)|:)[^;\n]{0,200}?(?:\|\||\?\?|\bor\b|(?:getenv|environ\.get|Getenv)\s*\([^,)]*,)\s*(["'`])([^"'`]*)\2/g;

// ¿Parece un valor secreto? Aquí se juega la regla entera, porque el nombre solo no basta: un
// `tokenKey = "ACCESS_TOKEN"` es la CLAVE con la que se guarda el token, y `passwordLabel` es un
// texto de interfaz. Un secreto real no tiene espacios y mezcla al menos dos clases de caracteres.
// Los separadores `._-/:` no cuentan como clase: si contaran, cualquier clave de traducción
// (`auth.password.label`) pasaría por secreto.
//
// Mayúsculas y minúsculas cuentan como UNA sola clase: `"Authorization"` o un nombre de cabecera no
// son secretos por tener las dos. Una cadena solo de letras pasa por secreto únicamente si es larga y
// alterna mayúsculas como lo hace un valor aleatorio. Una URL tampoco lo es, salvo que lleve
// credenciales (`user:pass@`).
function looksSecret(value) {
  if (value.length < 8 || /\s/.test(value)) return false;
  if (/^<.*>$/.test(value) || /^(.)\1+$/.test(value)) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return /:\/\/[^/@\s]+:[^/@\s]+@/.test(value);

  const classes = [/[A-Za-z]/, /[0-9]/, /[^\w./:-]/].filter((c) => c.test(value)).length;
  if (classes >= 2) return true;
  const switches = (value.match(/[a-z][A-Z]|[A-Z][a-z]/g) || []).length;
  return /^[A-Za-z]+$/.test(value) && value.length >= 20 && switches >= 6;
}

// Lo que delató al secreto: su nombre o su forma. Nunca el valor — copiarlo a la evidencia lo
// filtraría a un segundo archivo.
function hardcodedSecret(line, file) {
  if (isTestFile(file)) return null;

  for (const [kind, shape] of KNOWN_SECRETS) if (shape.test(line)) return kind;

  // Un valor que interpola no es un literal: lo que se ve es el nombre de otra variable. Cada lenguaje
  // interpola a su manera —en Dart `$x` es una variable, en JS `'$x'` es texto—, así que lo decide
  // `interpolates`, el mismo que usa la regla de SQL.
  for (const pattern of [ASSIGNED, FALLBACK]) {
    for (const [, name, quote, value] of line.matchAll(pattern)) {
      if (secretName(name) && looksSecret(value) && !interpolates(value, '', quote, file)) return name;
    }
  }
  return null;
}

// ── tls-disabled (R3) ─────────────────────────────────────────────────────────────────────────

// Apagar la verificación tiene dos formas. Una es un interruptor con nombre propio, que no admite
// lectura inocente. La otra es un callback de validación que devuelve `true` a todo: validar de
// verdad —el certificate pinning— usa el MISMO callback, y lo único que lo distingue es lo que
// devuelve. Por eso se exige el `true` literal y nada más.
const TLS_SWITCHES = [
  /\brejectUnauthorized\s*:\s*false\b/,
  /\bNODE_TLS_REJECT_UNAUTHORIZED\b\s*=\s*["']?0\b/,
  /\bverify\s*=\s*False\b/,
  /\b_create_unverified_context\b/,
  /\bCERT_NONE\b/,
  /\bDangerousAcceptAnyServerCertificateValidator\b/,
  /\bNoopHostnameVerifier\b|\bALLOW_ALL_HOSTNAME_VERIFIER\b/
];
const TLS_CALLBACK = /(?:\b|set)(badCertificateCallback|onBadCertificate|ServerCertificate(?:Custom)?ValidationCallback|[hH]ostnameVerifier)\b/;
const ACCEPTS_ALL = /(?:=>|->)\s*\(?\s*true\b|\{\s*(?:return\s+)?true\s*;?\s*\}/;

function tlsDisabled(line) {
  for (const sw of TLS_SWITCHES) {
    const m = sw.exec(line);
    if (m) return m[0];
  }
  const callback = TLS_CALLBACK.exec(line);
  return callback && ACCEPTS_ALL.test(line.slice(callback.index)) ? callback[1] : null;
}

// ── insecure-transport (R4, R11) ──────────────────────────────────────────────────────────────

const HTTP_URL = /\bhttp:\/\/(\[[^\]]*\]|[^\s"'`/:?#]+)/g;

// Hosts que no salen de la máquina. 10.0.2.2 es como el emulador de Android llega al host.
const LOCAL_HOST = /^(?:localhost|127(?:\.\d+){3}|10\.0\.2\.2|0\.0\.0\.0|\[::1\])$/i;

// Espacios de nombres XML: identificadores con forma de URL a los que nadie se conecta.
const NAMESPACE_HOST = /^(?:www\.w3\.org|schemas\.android\.com|schemas\.xmlsoap\.org|schemas\.microsoft\.com|schemas\.openxmlformats\.org|purl\.org|xmlns\.com|ns\.adobe\.com|json-schema\.org)$/i;

function insecureTransport(line, file) {
  if (isTestFile(file)) return null;
  for (const [url, host] of line.matchAll(HTTP_URL)) {
    if (!LOCAL_HOST.test(host) && !NAMESPACE_HOST.test(host)) return url;
  }
  return null;
}

// ── sql-concat (R5) ───────────────────────────────────────────────────────────────────────────

// Un literal con su prefijo: `f"…"` en Python, `$"…"` y `$@"…"` en C#.
const LITERAL = /(?<!\w)(\$@?|@\$|[fFrRbB]{1,2})?(["'`])((?:\\.|(?!\2)[^\\])*)\2/g;

// SQL en mayúsculas basta. En minúsculas la misma forma aparece en textos de interfaz («Select an
// item from the list»), así que se pide además algo que solo tiene una consulta.
const SQL_UPPER = /\b(?:SELECT\b[^]*\bFROM|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/;
const SQL_ANY = /\b(?:select\b[^]*\bfrom|insert\s+into|update\s+\w+\s+set|delete\s+from)\b/i;
const SQL_ONLY = /\bwhere\b|\bvalues\b|[=*]/i;
const isSql = (text) => SQL_UPPER.test(text) || (SQL_ANY.test(text) && SQL_ONLY.test(text));

// ¿El literal mete valores dentro? Cada lenguaje interpola a su manera, y lo que en uno es
// interpolación en otro es texto: `$1` es un parámetro de PostgreSQL, `$name` una variable de Dart.
function interpolates(content, prefix = '', quote, file) {
  const ext = extOf(file);
  if (ext === '.dart' || ext === '.kt') return /\$[A-Za-z_{]/.test(content);
  if (quote === '`') return content.includes('${');
  if (/[fF$]/.test(prefix)) return /\{[^}]+\}/.test(content);
  return false;
}

// ¿Se le pega un valor por fuera? `+ x`, `% x` o `.format(` a la derecha; `x +` a la izquierda.
const CONCAT_AFTER = /^\s*(?:\+\s*[^\s"'`]|%\s*[\w(]|\.format\s*\()/;
const CONCAT_BEFORE = /[\w)\]]\s*\+\s*$/;

function sqlConcat(line, file) {
  for (const m of line.matchAll(LITERAL)) {
    const [whole, prefix, quote, content] = m;
    if (!isSql(content)) continue;

    const after = line.slice(m.index + whole.length);
    const before = line.slice(0, m.index);
    if (interpolates(content, prefix, quote, file) || CONCAT_AFTER.test(after) || CONCAT_BEFORE.test(before)) {
      return content.trim().split(/\s+/)[0].toUpperCase();
    }
  }
  return null;
}

// ── valores variables ─────────────────────────────────────────────────────────────────────────

// ¿Lo que empieza en `rest` es un valor que cambia en ejecución? Un literal fijo, solo, no lo es;
// un identificador, una interpolación o una concatenación sí. Lo comparten las reglas que solo son
// peligrosas con datos: `eval("2+2")` no inyecta nada, `eval(input)` sí.
function isVariable(rest, file) {
  const text = rest.trimStart();
  if (!text || /^[)\]}]/.test(text)) return false;

  LITERAL.lastIndex = 0;
  const m = LITERAL.exec(text);
  if (!m || m.index !== 0) return true;

  const [whole, prefix, quote, content] = m;
  return interpolates(content, prefix, quote, file) || /^\s*\+/.test(text.slice(whole.length));
}

// ── dynamic-eval (R6) ─────────────────────────────────────────────────────────────────────────

// Llamadas que ejecutan código o pasan por un shell. `exec(` sin punto delante es la forma de Python
// y de un `exec` importado; `.exec(` con punto es también `regex.exec(texto)`, que no ejecuta nada, así
// que esa forma solo cuenta cuando recibe un comando ARMADO como texto (`cp.exec(\`rm ${dir}\`)`):
// nadie le pasa a una expresión regular una plantilla con interpolación.
const CODE_RUNNERS = /(?<![.\w])(eval|exec|execSync)\s*\(|\.(execSync)\s*\(|\bnew\s+(Function)\s*\(|\b(os\.system)\s*\(|getRuntime\(\)\s*\.(exec)\s*\(|\.(exec)\s*\(\s*(?=[`"'])/g;

function dynamicEval(line, file) {
  for (const m of line.matchAll(CODE_RUNNERS)) {
    const name = m.slice(1).find(Boolean);
    const args = line.slice(m.index + m[0].length);
    // `new Function` siempre recibe el cuerpo como texto, y nadie lo escribe a mano fijo.
    if (name === 'Function') return name;
    // Fuera de Python, `exec` es un nombre corriente —un ejecutor propio, un helper de tests—, así
    // que solo cuenta cuando recibe un comando armado como texto.
    const bareJsExec = (name === 'exec' || name === 'execSync') && !m[2] && !m[6] && extOf(file) !== '.py';
    if (bareJsExec && !/^\s*["'`]/.test(args)) continue;
    if (isVariable(args, file)) return name;
  }
  // `shell=True` convierte cualquier valor interpolado en parte del comando.
  if (/\bshell\s*=\s*True\b/.test(line) && [...line.matchAll(LITERAL)].some((l) => interpolates(l[3], l[1], l[2], file))) {
    return 'shell=True';
  }
  // Lo mismo en Node: `spawn(cmd, { shell: true })` con un comando que no es un literal fijo.
  const node = /\b(spawn|spawnSync|execFile|execFileSync)\s*\(/.exec(line);
  if (node && /\bshell\s*:\s*true\b/.test(line) && isVariable(line.slice(node.index + node[0].length), file)) return 'shell:true';
  return null;
}

// ── unsafe-html (R7) ──────────────────────────────────────────────────────────────────────────

const HTML_SINKS = /\.(innerHTML|outerHTML)\s*\+?=(?!=)|\b(insertAdjacentHTML|document\.write(?:ln)?)\s*\(|\b(dangerouslySetInnerHTML|bypassSecurityTrustHtml)\b/g;
// ¿Es la expresión entera UNA llamada a sanitize(...)? Antes bastaba con que `sanitize(` apareciera en
// la línea, y `innerHTML = sanitize(a) + userInput` pasaba por limpio.
function wholySanitized(expr) {
  const m = /^\s*(?:[\w$]+\.)*sanitize\s*\(/.exec(expr);
  if (!m) return false;
  let depth = 1;
  let i = m[0].length;
  for (; i < expr.length && depth; i++) {
    if (expr[i] === '(') depth++;
    else if (expr[i] === ')') depth--;
  }
  // Detrás solo puede quedar el cierre de la sentencia o del JSX (`;`, `}}`, `/>`), nunca más datos.
  return depth === 0 && /^[\s;,)}\]/>]*$/.test(expr.slice(i));
}

// La expresión que llega al sumidero: tras `=`, el argumento de la llamada, o el `__html` de React.
const sinkValue = (rest) => {
  const html = /__html\s*:\s*/.exec(rest);
  return html ? rest.slice(html.index + html[0].length) : rest.replace(/^\s*[=(]?/, '');
};

function unsafeHtml(line, file) {
  for (const m of line.matchAll(HTML_SINKS)) {
    const name = m.slice(1).find(Boolean);
    if (wholySanitized(sinkValue(line.slice(m.index + m[0].length)))) continue;
    // Asignar un marcado fijo (`innerHTML = ''`, `"<hr>"`) no mete datos de nadie.
    if (/^(?:inner|outer)HTML$/.test(name) && !isVariable(line.slice(m.index + m[0].length), file)) continue;
    return name;
  }
  return null;
}

// ── weak-hash (R8) ────────────────────────────────────────────────────────────────────────────

const WEAK_HASHES = [
  /\bcreateHash\s*\(\s*["'](md5|sha1)["']/i,
  /\b(md5|sha1)\.convert\s*\(/,
  /\bhashlib\.(md5|sha1)\b/,
  /\bhashlib\.new\s*\(\s*["'](md5|sha1)["']/i,
  /\bMessageDigest\.getInstance\s*\(\s*"(MD5|SHA-?1)"/i,
  /\b(MD5|SHA1)\.Create\s*\(/,
  /\bnew\s+(MD5|SHA1)(?:CryptoServiceProvider|Managed)\b/
];

function weakHash(line) {
  for (const shape of WEAK_HASHES) {
    const m = shape.exec(line);
    if (m) return m[1].toLowerCase().replace('-', '');
  }
  return null;
}

// Las comprobaciones, una por regla. Cada una recibe la línea y el archivo y devuelve lo que la
// delató, o null.
export const CHECKS = [
  { rule: RULES.hardcodedSecret, find: hardcodedSecret },
  { rule: RULES.tlsDisabled, find: tlsDisabled },
  { rule: RULES.insecureTransport, find: insecureTransport },
  { rule: RULES.sqlConcat, find: sqlConcat },
  { rule: RULES.dynamicEval, find: dynamicEval },
  { rule: RULES.unsafeHtml, find: unsafeHtml },
  { rule: RULES.weakHash, find: weakHash }
];
