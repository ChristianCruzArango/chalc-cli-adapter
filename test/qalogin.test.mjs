// test/qalogin.test.mjs — motor data-driven de login QA (specs/004-qa-login, R1/R4/R6).
// Todo con fetchImpl inyectado: cero red, cero endpoints reales.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLoginConfig, loginFields, interpolate, buildLoginRequest, extractToken, loginEndpointPreview, performLogin, validateLoginEndpoint } from '../lib/qalogin.mjs';

const SICEP = {
  url: 'http://localhost:5002/api/auth/generate-token',
  method: 'POST',
  query: { userType: '${userType}' },
  tokenPath: 'datos.token',
  fields: [{ name: 'userType', label: 'Tipo de usuario', default: 'admin' }]
};

test('R1: resolveLoginConfig — inputs.login pisa .chalc.json qa.login; null si no hay', () => {
  const chalcJson = { qa: { login: { url: 'A', tokenPath: 'a' } } };
  const inputs = { login: { url: 'B', tokenPath: 'b' } };
  assert.equal(resolveLoginConfig(chalcJson, inputs).url, 'B');           // inputs gana
  assert.equal(resolveLoginConfig(chalcJson, null).url, 'A');            // cae a chalc.json
  assert.equal(resolveLoginConfig({}, {}), null);                        // no hay contrato
  assert.equal(resolveLoginConfig(null, null), null);
});

test('R2: loginFields normaliza los campos declarados (o vacío)', () => {
  assert.deepEqual(loginFields(SICEP), [{ name: 'userType', label: 'Tipo de usuario', default: 'admin', secret: false }]);
  const creds = loginFields({ fields: [{ name: 'email' }, { name: 'password', secret: true }] });
  assert.deepEqual(creds, [
    { name: 'email', label: 'email', default: '', secret: false },
    { name: 'password', label: 'password', default: '', secret: true }
  ]);
  assert.deepEqual(loginFields({}), []);
});

test('R4: interpolate reemplaza ${campo} en strings anidados de objetos', () => {
  const out = interpolate({ q: { userType: '${userType}' }, b: { email: '${email}', fijo: 'x' } }, { userType: 'admin', email: 'a@b.co' });
  assert.deepEqual(out, { q: { userType: 'admin' }, b: { email: 'a@b.co', fijo: 'x' } });
});

test('R4: buildLoginRequest arma query en la URL (codificada) y body JSON', () => {
  const q = buildLoginRequest(SICEP, { userType: 'admin' });
  assert.equal(q.url, 'http://localhost:5002/api/auth/generate-token?userType=admin');
  assert.equal(q.method, 'POST');
  const withBody = buildLoginRequest({ url: 'http://x/login', body: { email: '${email}', password: '${password}' }, tokenPath: 'token' }, { email: 'a@b.co', password: 'p@ss word' });
  assert.equal(withBody.url, 'http://x/login');
  assert.equal(withBody.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(withBody.body), { email: 'a@b.co', password: 'p@ss word' });
});

test('R4/R6: extractToken navega por ruta con puntos; null si falta', () => {
  assert.equal(extractToken({ datos: { token: 'abc' } }, 'datos.token'), 'abc');
  assert.equal(extractToken({ token: 'xyz' }, 'token'), 'xyz');
  assert.equal(extractToken({ datos: {} }, 'datos.token'), null);
  assert.equal(extractToken(null, 'a.b'), null);
});

test('login endpoint se resume sin query/credenciales y se limita al origen de la app', () => {
  assert.deepEqual(loginEndpointPreview({ url: 'http://user:pass@localhost:5002/login?token=secret', method: 'post' }), { method: 'POST', url: 'http://localhost:5002/login' });
  assert.equal(validateLoginEndpoint('http://localhost:5002/login', { baseUrl: 'http://localhost:5002/app' }).origin, 'http://localhost:5002');
  assert.equal(validateLoginEndpoint('http://localhost:5002/login', { baseUrl: 'http://127.0.0.1:4200' }).hostname, 'localhost');
  assert.throws(() => validateLoginEndpoint('https://evil.test/login', { baseUrl: 'http://localhost:5002' }), /debe pertenecer/);
});

test('R4: performLogin hace la petición y devuelve el token', async () => {
  let seen = null;
  const fetchImpl = async (url, opts) => { seen = { url, opts }; return { ok: true, status: 200, json: async () => ({ datos: { token: 'JWT-OK' } }), text: async () => '' }; };
  const token = await performLogin(SICEP, { userType: 'admin' }, { fetchImpl, baseUrl: 'http://localhost:5002' });
  assert.equal(token, 'JWT-OK');
  assert.equal(seen.url, 'http://localhost:5002/api/auth/generate-token?userType=admin');
  assert.equal(seen.opts.method, 'POST');
});

test('R6: performLogin lanza error claro si el HTTP no es OK', async () => {
  const fetchImpl = async () => ({ ok: false, status: 401, json: async () => ({}), text: async () => 'credenciales inválidas' });
  await assert.rejects(() => performLogin(SICEP, { userType: 'x' }, { fetchImpl, baseUrl: 'http://localhost:5002' }), /401/);
});

test('R6: performLogin lanza error claro si el tokenPath no está en la respuesta', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ datos: {} }), text: async () => '{}' });
  await assert.rejects(() => performLogin(SICEP, { userType: 'admin' }, { fetchImpl, baseUrl: 'http://localhost:5002' }), /datos\.token/);
});
