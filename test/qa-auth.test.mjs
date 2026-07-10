// test/qa-auth.test.mjs — auth del agente QA en modo NO interactivo: un token pasado por
// flag/env debe inyectarse sin TTY (antes solo se podía en interactivo, dejando BLOCKED todo
// endpoint protegido). Ver spec 012 / prueba SICEP.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promptAuthIfNeeded, collectQaCredentials } from '../lib/commands/qa.mjs';

// Prompter falso: devuelve respuestas prefijadas por campo (text/secret comparten cola).
function fakePrompter(answers) {
  const q = [...answers];
  return { text: async () => q.shift() ?? '', secret: async () => q.shift() ?? '', close() {} };
}

const FIELDS = [{ name: 'userType', label: 'Tipo', default: 'admin', secret: false }];
const LOGIN_FIELDS = [{ name: 'email', label: 'email', default: '', secret: false }, { name: 'password', label: 'password', default: '', secret: true }];

test('R3: no interactivo — lee --auth-<campo> y CHALC_QA_<CAMPO>, sin prompts', async () => {
  const byFlag = await collectQaCredentials(LOGIN_FIELDS, { prompter: null, flags: { 'auth-email': 'a@b.co', 'auth-password': 'secreta' }, env: {} });
  assert.deepEqual(byFlag, { email: 'a@b.co', password: 'secreta' });
  const byEnv = await collectQaCredentials(LOGIN_FIELDS, { prompter: null, flags: {}, env: { CHALC_QA_EMAIL: 'x@y.co', CHALC_QA_PASSWORD: 'p' } });
  assert.deepEqual(byEnv, { email: 'x@y.co', password: 'p' });
});

test('R3: no interactivo con default aplica el default; campo requerido sin valor → error claro', async () => {
  assert.deepEqual(await collectQaCredentials(FIELDS, { prompter: null, flags: {}, env: {} }), { userType: 'admin' });
  await assert.rejects(
    () => collectQaCredentials(LOGIN_FIELDS, { prompter: null, flags: { 'auth-email': 'a@b.co' }, env: {} }),
    /password|CHALC_QA_PASSWORD/
  );
});

test('R2: interactivo pregunta cada campo; vacío cae al default; secret usa prompt oculto', async () => {
  // email respondido, password vacío (usará secret vacío → no hay default → pero es requerido…)
  const creds = await collectQaCredentials(LOGIN_FIELDS, { prompter: fakePrompter(['a@b.co', 'clave123']), flags: {}, env: {} });
  assert.deepEqual(creds, { email: 'a@b.co', password: 'clave123' });
  // campo con default: si el usuario responde vacío, se usa el default
  const withDef = await collectQaCredentials(FIELDS, { prompter: fakePrompter(['']), flags: {}, env: {} });
  assert.deepEqual(withDef, { userType: 'admin' });
});

test('R3: el flag/env explícito gana y evita el prompt aunque haya prompter', async () => {
  const creds = await collectQaCredentials(FIELDS, { prompter: fakePrompter(['NO-DEBERIA-USARSE']), flags: { 'auth-userType': 'analista' }, env: {} });
  assert.deepEqual(creds, { userType: 'analista' });
});

const makeProj = () => mkdtemp(join(tmpdir(), 'chalc-qa-auth-'));

test('preset con token → inyecta el header SIN prompter (no interactivo), sin depender de detectAuth', async () => {
  const proj = await makeProj();   // dir vacío: detectAuth no marcaría auth, pero el token explícito manda
  try {
    const auth = await promptAuthIfNeeded(null, proj, { token: 'jwt-de-prueba' });
    assert.deepEqual(auth, { headers: { Authorization: 'Bearer jwt-de-prueba' } });
  } finally { await rm(proj, { recursive: true, force: true }); }
});

test('sin preset y sin prompter → null (comportamiento previo intacto)', async () => {
  const proj = await makeProj();
  try {
    assert.equal(await promptAuthIfNeeded(null, proj), null);
    assert.equal(await promptAuthIfNeeded(null, proj, {}), null);   // preset vacío no cambia nada
  } finally { await rm(proj, { recursive: true, force: true }); }
});
