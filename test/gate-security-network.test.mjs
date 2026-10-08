// spec 014 — etapa `security` del portón: TLS y transporte sin cifrar.
//
// Cada regla se prueba en las dos direcciones: lo que TIENE que disparar y lo que no. La segunda
// mitad es la que mantiene viva la etapa: un detector con falsos positivos se silencia a base de
// `chalc-allow` hasta que nadie lee lo que dice.

import test from 'node:test';
import assert from 'node:assert/strict';
import { scanSource } from '../catalog/gate/lib/security.mjs';

const rulesIn = (text, file) => scanSource(text, { file }).map((f) => f.rule);

// ── T4 (R3): tls-disabled ─────────────────────────────────────────────────────────────────────

const tlsIn = (text, file) => rulesIn(text, file).filter((r) => r === 'tls-disabled');

test('R3: accepting any certificate fires, in every stack that can do it', async () => {
  const cases = [
    ['client.badCertificateCallback = (cert, host, port) => true;', 'lib/api/client.dart'],
    ['..badCertificateCallback = ((X509Certificate cert, String host, int port) => true);', 'lib/api/client.dart'],
    ['adapter.onBadCertificate = (cert) { return true; };', 'lib/api/dio.dart'],
    ['const agent = new https.Agent({ rejectUnauthorized: false });', 'src/http.ts'],
    ["process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';", 'src/main.js'],
    ['r = requests.get(url, verify=False)', 'app/client.py'],
    ['ctx = ssl._create_unverified_context()', 'app/client.py'],
    ['ctx.verify_mode = ssl.CERT_NONE', 'app/client.py'],
    ['handler.ServerCertificateCustomValidationCallback = (m, c, ch, e) => true;', 'src/Api.cs'],
    ['handler.ServerCertificateCustomValidationCallback = HttpClientHandler.DangerousAcceptAnyServerCertificateValidator;', 'src/Api.cs'],
    ['builder.hostnameVerifier { _, _ -> true }', 'src/Net.kt'],
    ['conn.setHostnameVerifier((h, s) -> true);', 'src/Net.java'],
    ['client.setHostnameVerifier(NoopHostnameVerifier.INSTANCE);', 'src/Net.java']
  ];
  for (const [text, file] of cases) assert.equal(tlsIn(text, file).length, 1, `${file}: ${text}`);
});

// Validar de verdad el certificado tiene la misma forma que apagarlo; la diferencia es lo que se
// devuelve. Confundirlas castigaría justo el certificate pinning, que es lo que se pide hacer.
test('R3: validating the certificate does not fire', async () => {
  const cases = [
    ['client.badCertificateCallback = (cert, host, port) => cert.sha256 == pinnedSha;', 'lib/api/client.dart'],
    ['client.badCertificateCallback = (cert, host, port) => false;', 'lib/api/client.dart'],
    ['const agent = new https.Agent({ rejectUnauthorized: true });', 'src/http.ts'],
    ['r = requests.get(url, verify=True)', 'app/client.py'],
    ['r = requests.get(url, verify="/etc/ssl/ca.pem")', 'app/client.py'],
    ['// rejectUnauthorized: false', 'src/http.ts']
  ];
  for (const [text, file] of cases) assert.deepEqual(tlsIn(text, file), [], `${file}: ${text}`);
});

// Un test que apaga TLS contra un servidor de verdad sigue siendo un agujero: R11 solo exime a
// los secretos y a las URLs, que en un fixture son falsos por diseño.
test('R3: tls-disabled still applies to test files', async () => {
  assert.equal(tlsIn('const a = new https.Agent({ rejectUnauthorized: false });', 'test/http.test.ts').length, 1);
});

// ── T5 (R4, R11): insecure-transport ──────────────────────────────────────────────────────────

const transportIn = (text, file) => scanSource(text, { file }).filter((f) => f.rule === 'insecure-transport');

test('R4: an http URL to a real host fires and names the host', async () => {
  const cases = [
    ["static final _site = Uri.parse('http://cacruz.com/');", 'lib/app/shell/author_credit.dart'],
    ['const API = "http://api.example.com/v1";', 'src/api.ts'],
    ['BASE_URL = "http://192.168.1.20:8080"', 'app/settings.py'],
    ['private const string Url = "http://pagos.example.com";', 'src/Pagos.cs']
  ];
  for (const [text, file] of cases) {
    const found = transportIn(text, file);
    assert.equal(found.length, 1, `${file}: ${text}`);
    assert.match(found[0].data.match, /^http:\/\/[\w.-]+/);
  }
});

// Desarrollo local: el emulador de Android llega al host por 10.0.2.2. Ahí no hay red que espiar.
test('R4: local hosts do not fire', async () => {
  const cases = [
    'const a = "http://localhost:3000/api";',
    'const b = "http://127.0.0.1:8080";',
    'const c = "http://10.0.2.2:8000";',
    'const d = "http://0.0.0.0:5000";',
    'const e = "http://[::1]:3000";',
    'const f = "https://api.example.com";'
  ];
  for (const text of cases) assert.deepEqual(transportIn(text, 'src/api.ts'), [], text);
});

// Los espacios de nombres XML son identificadores con forma de URL: nadie se conecta a ellos.
test('R4: xml namespaces are identifiers, not connections', async () => {
  const cases = [
    'const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");',
    'const ns = "http://schemas.android.com/apk/res/android";',
    'const s = "http://schemas.xmlsoap.org/soap/envelope/";'
  ];
  for (const text of cases) assert.deepEqual(transportIn(text, 'src/xml.ts'), [], text);
});

test('R11: test files are exempt from insecure-transport', async () => {
  assert.deepEqual(transportIn('const u = "http://api.example.com";', 'test/api.test.ts'), []);
});

