// T2 (spec 017, R6) — una sola definición de «archivo de credenciales».
//
// La redacción de chalc (lo que el modelo puede ver de un `.env`) y la guarda del asistente (lo que
// Claude Code no puede leer) tienen que estar de acuerdo en qué es un archivo de credenciales. Dos
// listas se desincronizan: la que se queda atrás no falla, deja pasar un `.pypirc`. Por eso vive en
// UN módulo dentro de `catalog/gate/lib/` (se emite al repo equipado junto con la guarda) y
// `lib/redact.mjs` lo re-exporta.

import test from 'node:test';
import assert from 'node:assert/strict';
import { isSecretFile, isEnvTemplate } from '../catalog/gate/lib/secret-files.mjs';
import { isSecretFile as redactIsSecretFile } from '../lib/redact.mjs';

const SECRET = [
  '.env', '.env.local', 'config/.env.production', 'config\\.env', '.ENV',
  '.npmrc', '.pypirc', '.netrc', '.git-credentials',
  'credentials', 'aws/credentials.json', 'secret.json', 'secrets.yaml', 'secrets.yml', 'secret.toml',
  'id_rsa', 'id_dsa', 'id_ecdsa', '/home/u/.ssh/id_ed25519',
  'certs/server.key', 'tls.pem', 'cert.p12', 'cert.pfx', 'android/app.keystore', 'release.jks'
];

const NOT_SECRET = [
  'src/env.ts', 'environment.ts', 'keys.md', 'README.md', '', 'id_rsa.pub', 'my.env.ts',
  'credentials.md', 'secrets.md', 'docs/pem.txt', 'npmrc.md', 'src/.envrc.js'
];

test('R6: credential files are recognised by name, in any folder and with either separator', () => {
  for (const f of SECRET) assert.equal(isSecretFile(f), true, f);
});

test('R6: files that only look like credentials are not', () => {
  for (const f of NOT_SECRET) assert.equal(isSecretFile(f), false, f);
});

test('R6: an absent path is not a credential file', () => {
  assert.equal(isSecretFile(undefined), false);
  assert.equal(isSecretFile(null), false);
});

test('R6: redaction and guard share the very same definition', () => {
  assert.equal(redactIsSecretFile, isSecretFile);
});

test('R6: .env.example, .env.sample and .env.template are value-less templates', () => {
  for (const f of ['.env.example', '.env.sample', '.env.template', 'apps/api/.env.example', 'cfg\\.env.sample', '.ENV.EXAMPLE']) {
    assert.equal(isEnvTemplate(f), true, f);
  }
});

test('R6: any other .env is not a template', () => {
  for (const f of ['.env', '.env.local', '.env.example.bak', '.env.production', 'example.env', 'env.example', '', undefined]) {
    assert.equal(isEnvTemplate(f), false, String(f));
  }
});

test('R6: a template is still redacted as a credential file (redaction keeps its behaviour)', () => {
  assert.equal(isSecretFile('.env.example'), true);
});
