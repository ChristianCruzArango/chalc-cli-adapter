// Sesión del agente de `chalc qa`: token directo, login con el contrato del proyecto o la sesión que
// el usuario adjunta a mano.

import { join } from 'node:path';
import { t } from '../i18n.mjs';
import { detectAuth, resolveQaAuth } from '../qa.mjs';
import { resolveLoginConfig, loginFields, loginEndpointPreview, performLogin } from '../qalogin.mjs';
import { c, flags } from './context.mjs';
import { readJsonOrKeep } from '../userdata.mjs';

// Lee el .chalc.json del proyecto (opcional). Devuelve {} si no existe; si es ilegible, se respalda,
// se avisa y también {} (lib/userdata.mjs).
const readChalcJson = (proj) => readJsonOrKeep(join(proj, '.chalc.json'), {});

// Recolecta las credenciales de login QA de cada campo del contrato (specs/004-qa-login, R2/R3).
// Precedencia: --auth-<campo> / CHALC_QA_<CAMPO> (gana siempre, sirve para CI) > prompt interactivo
// (default como fallback si se responde vacío) > default del contrato. Un campo requerido sin valor
// en modo no interactivo aborta con un error claro. Los campos `secret` van por prompt oculto.
export async function collectQaCredentials(fields, { prompter, flags = {}, env = {} } = {}) {
  const creds = {};
  for (const f of fields) {
    const explicit = flags[`auth-${f.name}`] != null ? String(flags[`auth-${f.name}`])
      : (env[`CHALC_QA_${f.name.toUpperCase()}`] != null ? String(env[`CHALC_QA_${f.name.toUpperCase()}`]) : '');
    let value = explicit;
    if (!value && prompter) {
      const label = f.default ? `${f.label} [${f.default}]` : f.label;
      value = ((f.secret ? await prompter.secret(label) : await prompter.text(label)) || '').trim();
    }
    if (!value) value = f.default;
    if (!value) throw new Error(t('qaLoginMissingCredential', f.name, `CHALC_QA_${f.name.toUpperCase()}`));
    creds[f.name] = value;
  }
  return creds;
}

// La sesión que el usuario adjunta a mano: storage del navegador o un header Bearer.
async function askSession(prompter, det) {
  const methods = [
    { label: t('qaAuthStorage'), value: 'storage' },
    { label: t('qaAuthHeader'), value: 'header' },
    { label: t('qaAuthSkip'), value: 'skip' }
  ];
  const method = methods[await prompter.select(t('qaAuthMethodQ'), methods, det.storageKeys.length ? 0 : 1)].value;
  if (method === 'skip') return null;
  if (method === 'header') {
    const token = (await prompter.secret(t('qaAuthTokenQ'))).trim();
    return token ? { headers: { Authorization: `Bearer ${token}` } } : null;
  }
  const hint = det.storageKeys.length ? t('qaAuthDetected', det.storageKeys.join(', ')) : '';
  const key = (await prompter.text(t('qaAuthStorageKeyQ', hint))).trim();
  const type = (await prompter.yesno(t('qaAuthIsSessionQ'), false)) ? 'session' : 'local';
  const value = (await prompter.secret(t('qaAuthValueQ'))).trim();
  return key && value ? { storage: [{ type, key, value }] } : null;
}

// Detecta si la app exige autenticación y, de ser así, le PIDE al usuario la sesión (no falla en silencio).
// Devuelve { headers?, storage? } para inyectar en el navegador, o null si no hace falta / se omite.
// preset: token pasado por flag/env (--auth-token / CHALC_QA_TOKEN); si resuelve, gana SIEMPRE — así
// se prueban endpoints protegidos sin TTY (antes esto dejaba BLOCKED todo endpoint autenticado en CI).
export async function promptAuthIfNeeded(prompter, proj, preset) {
  const fromPreset = resolveQaAuth(preset || {});
  if (fromPreset) return fromPreset;
  const det = await detectAuth(proj);
  if (!det.needsAuth) return null;
  console.log(c.yellow('\n⚠ ' + t('qaAuthRequired', det.signals.join(', '))));
  if (!prompter) {
    console.log(c.dim('  ' + t('qaAuthNonInteractive')));
    return null;
  }
  return askSession(prompter, det);
}

// Si el agente va a correr y la app exige auth, la sesión se PREPARA aquí (prompter aún vivo), pero el
// login por red se EJECUTA después de levantar la app (todavía no responde en este punto).
// Orden: (1) token directo --auth-token/CHALC_QA_TOKEN gana SIEMPRE (R7, CI o token externo);
// (2) si no, y el proyecto define un contrato de login QA, chalc pide las credenciales y hace el
// login él mismo — el humano no pega JWTs (specs/004-qa-login); (3) si no, el flujo de siempre.
// Devuelve { qaAuth, pendingLogin }: la sesión ya resuelta o el login diferido.
export async function prepareAgentAuth(prompter, proj, qaInputs, o = flags) {
  const directToken = o['auth-token'] || process.env.CHALC_QA_TOKEN || '';
  if (directToken) return { qaAuth: await promptAuthIfNeeded(prompter, proj, { token: directToken }), pendingLogin: null };
  const loginCfg = resolveLoginConfig(await readChalcJson(proj), qaInputs);
  if (!loginCfg) return { qaAuth: await promptAuthIfNeeded(prompter, proj), pendingLogin: null };
  const preview = loginEndpointPreview(loginCfg);
  if (prompter) {
    const approved = await prompter.yesno(t('qaLoginConfirm', preview.method, preview.url), false);
    if (!approved) throw new Error(t('qaLoginCancelled'));
  } else if (!o['allow-login']) {
    throw new Error(t('qaLoginNeedsApproval'));
  }
  const credentials = await collectQaCredentials(loginFields(loginCfg), { prompter, flags: o, env: process.env });
  return { qaAuth: null, pendingLogin: { config: loginCfg, credentials } };
}

// Login diferido: ahora que la app responde, chalc se autentica con las credenciales recolectadas.
// Si falla, lanza y aborta el agente (R6).
export async function loginNow(pendingLogin, baseUrl, o = flags) {
  console.log(c.dim('  ' + t('qaLoginInProgress', loginEndpointPreview(pendingLogin.config).url)));
  const token = await performLogin(pendingLogin.config, pendingLogin.credentials, {
    baseUrl,
    allowExternal: o['allow-external-login'] === true
  });
  console.log(c.green('  ✓ ' + t('qaLoginOk')));
  return resolveQaAuth({ token });
}
