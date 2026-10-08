// spec 014 — etapa `security` del portón: secretos.
//
// Cada regla se prueba en las dos direcciones: lo que TIENE que disparar y lo que no. La segunda
// mitad es la que mantiene viva la etapa: un detector con falsos positivos se silencia a base de
// `chalc-allow` hasta que nadie lee lo que dice.

import test from 'node:test';
import assert from 'node:assert/strict';
import { scanSource } from '../catalog/gate/lib/security.mjs';

const rulesIn = (text, file) => scanSource(text, { file }).map((f) => f.rule);

// ── T3 (R2, R11): hardcoded-secret ────────────────────────────────────────────────────────────

const secretsIn = (text, file = 'src/config.ts') => rulesIn(text, file).filter((r) => r === 'hardcoded-secret');

test('R2: a private key header is a secret in any language', async () => {
  assert.equal(secretsIn('const k = "-----BEGIN RSA PRIVATE KEY-----";').length, 1);
  assert.equal(secretsIn("key = '-----BEGIN PRIVATE KEY-----'", 'app/keys.py').length, 1);
  assert.equal(secretsIn("const k = '-----BEGIN OPENSSH PRIVATE KEY-----';", 'lib/k.dart').length, 1);
});

test('R2: provider keys with a known shape are secrets whatever the variable is called', async () => {
  assert.equal(secretsIn('const x = "AKIAIOSFODNN7EXAMPLE";').length, 1, 'AWS');
  assert.equal(secretsIn("const x = 'AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q';", 'lib/a.dart').length, 1, 'Google');
  assert.equal(secretsIn('const x = "ghp_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8";').length, 1, 'GitHub');
  assert.equal(secretsIn('const x = "sk_live_51H8aB2cD3eF4gH5iJ6kL7m";').length, 1, 'Stripe');
  assert.equal(secretsIn('const x = "xoxb-123456789012-abcdefABCDEF";').length, 1, 'Slack');
});

test('R2: a secret-named identifier assigned a literal is a secret, in every dialect', async () => {
  const cases = [
    ['const apiKey = "a1b2c3d4e5f6";', 'src/api.ts'],
    ['const config = { clientSecret: "Zx9-Qw8-Er7" };', 'src/auth.ts'],
    ["static const apiKey = 'AbCdEf123456';", 'lib/env.dart'],
    ["final password = 'Admin2024';", 'lib/login.dart'],
    ['private const string ApiToken = "tok_9f8e7d6c";', 'src/Api.cs'],
    ['private static final String DB_PASSWORD = "Pa55word!";', 'src/Db.java'],
    ['val accessKey: String = "q1w2e3r4t5y6"', 'src/Keys.kt'],
    ['API_KEY = "abc123def456"', 'app/settings.py'],
    ['{ "auth_token": "eyJhbGciOi123" }', 'src/fixture.ts']
  ];
  for (const [text, file] of cases) assert.equal(secretsIn(text, file).length, 1, `${file}: ${text}`);
});

// Lo que NO es un secreto. Cada caso es un falso positivo que, de dispararse, enseñaría a silenciar
// la regla.
test('R2: values that are not secrets do not fire', async () => {
  const cases = [
    ['const apiKey = process.env.API_KEY;', 'src/api.ts'],
    ["final apiKey = const String.fromEnvironment('API_KEY');", 'lib/env.dart'],
    ["final token = Platform.environment['TOKEN'];", 'lib/env.dart'],
    ['const tokenKey = "ACCESS_TOKEN";', 'src/storage.ts'],
    ["const passwordField = 'password_input';", 'src/form.ts'],
    ["final passwordLabel = 'auth.password.label';", 'lib/l10n.dart'],
    ["const passwordHint = 'Enter your password';", 'src/form.ts'],
    ['const tokenType = "Bearer";', 'src/http.ts'],
    ['const token = `Bearer ${session.token}`;', 'src/http.ts'],
    ["final header = 'Bearer $token1234';", 'lib/http.dart'],
    ['if (password == "Admin2024") return;', 'src/auth.ts'],
    ['const apiKey = "";', 'src/api.ts'],
    ['const apiKey = "xxxxxxxxxxxx";', 'src/api.ts'],
    ['const apiKey = "<YOUR_API_KEY>";', 'src/api.ts']
  ];
  for (const [text, file] of cases) assert.deepEqual(secretsIn(text, file), [], `${file}: ${text}`);
});

test('R2: a secret in a comment does not fire', async () => {
  assert.deepEqual(secretsIn('// const apiKey = "a1b2c3d4e5f6";'), []);
});

// La evidencia nombra QUÉ se encontró, nunca el valor: copiar el secreto a gate.md lo filtraría a
// un segundo archivo.
test('R2: the finding names the secret but never copies its value', async () => {
  const [found] = scanSource('const apiKey = "a1b2c3d4e5f6";', { file: 'src/api.ts' });

  assert.equal(found.line, 1);
  assert.match(found.data.match, /apiKey/);
  assert.doesNotMatch(JSON.stringify(found), /a1b2c3d4e5f6/);
});

// Los fixtures de test llevan claves falsas a propósito: dispararse ahí no protege nada.
test('R11: test files are exempt from hardcoded-secret', async () => {
  const text = 'const apiKey = "a1b2c3d4e5f6";\nconst k = "AKIAIOSFODNN7EXAMPLE";';

  assert.deepEqual(secretsIn(text, 'test/api.test.ts'), []);
  assert.deepEqual(secretsIn(text, 'src/api.spec.ts'), []);
  assert.deepEqual(secretsIn("final apiKey = 'a1b2c3d4e5f6';", 'test/api_test.dart'), []);
});

