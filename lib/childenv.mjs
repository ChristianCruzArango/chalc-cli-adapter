// lib/childenv.mjs — el entorno con que chalc lanza procesos que no controla (comandos del agente,
// servidores MCP). Responsabilidad ÚNICA: que no hereden las credenciales del usuario por defecto.
//
// Heredar `process.env` entero daba a cualquier comando o servidor MCP las API keys del proveedor de
// IA, el PAT de Azure DevOps o el token de GitHub del usuario. Se quitan las variables cuyo NOMBRE es
// de credencial; el resto (PATH, HOME, SDKs, configuración de herramientas) se conserva, porque una
// lista blanca rompería toolchains de forma impredecible. Un servidor MCP que necesite un secreto lo
// recibe explícito en su `env` (con la interpolación `${VAR}` permitida por configuración local), y
// `CHALC_PASS_ENV=NPM_TOKEN,GH_TOKEN` deja pasar a propósito las que el usuario decida.

const SECRET_NAME = /(^|_)(API_?KEY|TOKEN|SECRET|SECRETS|PASSWORD|PASSWD|PASS|PAT|CREDENTIAL|CREDENTIALS|PRIVATE_?KEY|ACCESS_?KEY(_?ID)?|SESSION_?TOKEN)(_|$)/i;

export const isSecretEnvName = (name) => SECRET_NAME.test(String(name));

export function childEnv(extra = {}, env = process.env) {
  const pass = new Set(String(env.CHALC_PASS_ENV || '').split(',').map((s) => s.trim()).filter(Boolean));
  const out = {};
  for (const [name, value] of Object.entries(env)) {
    if (!isSecretEnvName(name) || pass.has(name)) out[name] = value;
  }
  return { ...out, ...extra };
}
