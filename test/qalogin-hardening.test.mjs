// T6 (spec 022, R18 F10 · R17 S9-qalogin) — el login QA reconoce las formas de loopback habituales
// (0.0.0.0, IPv4 mapeada en IPv6) y avisa cuando un campo secreto viajaría en la query string.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateLoginEndpoint, secretQueryFields } from '../lib/qalogin.mjs';
import { prepareAgentAuth } from '../lib/commands/qaauth.mjs';
import { t } from '../lib/i18n.mjs';

// ── F10 ──────────────────────────────────────────────────────────────────────────────────────────
test('F10: un front en http://0.0.0.0:4200 acepta el login de la API local en otro puerto', () => {
  assert.equal(validateLoginEndpoint('http://localhost:3000/login', { baseUrl: 'http://0.0.0.0:4200' }).port, '3000');
  assert.equal(validateLoginEndpoint('http://0.0.0.0:3000/login', { baseUrl: 'http://127.0.0.1:4200' }).port, '3000');
});

test('F10: [::ffff:127.0.0.1] cuenta como loopback', () => {
  assert.equal(validateLoginEndpoint('http://[::ffff:127.0.0.1]:3000/login', { baseUrl: 'http://localhost:4200' }).port, '3000');
});

test('F10: una IPv4 pública mapeada en IPv6 NO es loopback', () => {
  assert.throws(() => validateLoginEndpoint('http://[::ffff:8.8.8.8]:3000/login', { baseUrl: 'http://localhost:4200' }));
});

// ── S9: secreto en la query ──────────────────────────────────────────────────────────────────────
const contract = {
  url: 'http://localhost:3000/login', method: 'GET',
  query: { user: '${usuario}', pass: '${clave}' },
  fields: [{ name: 'usuario' }, { name: 'clave', secret: true }],
  tokenPath: 'token'
};

test('S9: secretQueryFields detecta los campos secretos interpolados en la query', () => {
  assert.deepEqual(secretQueryFields(contract), ['clave']);
  assert.deepEqual(secretQueryFields({ ...contract, query: { user: '${usuario}' }, body: { pass: '${clave}' } }), []);
});

test('S9: prepareAgentAuth avisa del secreto en la query ANTES de pedir aprobación', async () => {
  const proj = await mkdtemp(join(tmpdir(), 'chalc-qalogin-'));
  const logs = [];
  const original = console.log;
  console.log = (...a) => logs.push(a.join(' '));
  try {
    await writeFile(join(proj, '.chalc.json'), JSON.stringify({ qa: { login: contract } }));
    const prompter = { yesno: async () => { logs.push('<<aprobación>>'); return false; } };
    await assert.rejects(() => prepareAgentAuth(prompter, proj, null, {}));
  } finally {
    console.log = original;
    await rm(proj, { recursive: true, force: true });
  }
  const warn = logs.findIndex((l) => l.includes(t('qaLoginSecretInQuery', 'clave')));
  assert.ok(warn >= 0, 'debe avisar');
  assert.ok(warn < logs.indexOf('<<aprobación>>'), 'antes de aprobar');
});
