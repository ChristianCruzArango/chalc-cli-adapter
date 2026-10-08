const BOOLEAN_FLAGS = new Set(['help', 'skip-qa-inputs', 'dry-run', 'yes', 'y', 'force', 'allow-exec', 'allow-login', 'allow-external-login', 'plan', 'up', 'agent', 'ccr', 'repair-plan', 'rerun', 'doctor', 'verify', 'ai', 'strict', 'branch', 'full', 'json', 'check', 'screenshots', 'worktree', 'terminals', 'console', 'watch', 'judge', 'questions']);
const VALUE_FLAGS = new Set(['target', 'method', 'mode', 'stack', 'name', 'lang', 'doc', 'azure', 'pat', 'jira', 'email', 'token', 'url', 'feature', 'spec', 'env', 'surface', 'max-steps', 'profile', 'spec-model', 'qa-model', 'repair-model', 'architecture', 'description', 'dir', 'back', 'movil', 'mobile', 'path', 'auth-token', 'workspace-dir', 'port', 'rounds', 'out', 'budget']);

import { t } from './i18n.mjs';
// Flag booleana que npm run se TRAGÓ por escribirla sin el separador `--` (p.ej.
// `npm run dashboard --console`): npm no la pasa como argumento pero la deja en el entorno
// como npm_config_<flag>. Guiones del nombre → guion bajo, como hace npm.
export function npmConfigFlag(name, env = process.env) {
  return env['npm_config_' + name.replace(/-/g, '_')] === 'true';
}

function setFlag(out, key, value) {
  if (Object.hasOwn(out, key)) out[key] = Array.isArray(out[key]) ? out[key].concat(value) : [out[key], value];
  else out[key] = value;
}

const SHORT_FLAGS = { '-y': 'yes', '-h': 'help' };

// Nombres que tocarían el prototipo del objeto de flags (`--no-__proto__` lo sustituía).
const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);
const known = (key) => BOOLEAN_FLAGS.has(key) || VALUE_FLAGS.has(key) || key.startsWith('auth-');

// Flags con secretos y su alternativa por entorno. En la línea de comandos quedan en el historial del
// shell y a la vista de cualquiera con `ps`; se aceptan, pero se avisa.
const SECRET_FLAGS = { pat: 'CHALC_PAT', token: 'CHALC_TOKEN', 'auth-token': 'CHALC_QA_TOKEN' };
const secretAlternative = (key) => SECRET_FLAGS[key] || (key.startsWith('auth-') ? `CHALC_QA_${key.slice(5).toUpperCase().replace(/-/g, '_')}` : '');

// Una flag larga `--clave[=valor]` o `--no-clave`. `next` es el argumento siguiente, por si la flag
// toma su valor de él. Devuelve cuántos argumentos extra consumió (0 o 1).
function parseLong(a, next, flags, warnings) {
  const eq = a.indexOf('=');
  const rawKey = a.slice(2, eq === -1 ? undefined : eq);
  const key = rawKey.startsWith('no-') ? rawKey.slice(3) : rawKey;
  if (!key) throw new Error(t('argBadFlag', ''));
  if (RESERVED.has(key)) throw new Error(t('argBadFlag', rawKey));
  // `--no-x` también se valida: antes cualquier `--no-loquesea` pasaba sin error.
  if (rawKey.startsWith('no-')) {
    if (!known(key)) throw new Error(t('argUnknownFlag', rawKey));
    setFlag(flags, key, false);
    return 0;
  }
  const alternative = secretAlternative(key);
  if (alternative) warnings.push({ flag: key, env: alternative });
  if (BOOLEAN_FLAGS.has(key)) {
    setFlag(flags, key, eq === -1 ? true : !['0', 'false', 'no'].includes(a.slice(eq + 1).toLowerCase()));
    return 0;
  }
  // --auth-<campo>: credenciales de login QA, dinámicas por contrato (specs/004-qa-login), toman valor.
  if (!VALUE_FLAGS.has(key) && !key.startsWith('auth-')) throw new Error(t('argUnknownFlag', key));
  if (eq !== -1) {
    setFlag(flags, key, a.slice(eq + 1));
    return 0;
  }
  if (!next || next.startsWith('--')) throw new Error(t('argNeedsValue', key));
  setFlag(flags, key, next);
  return 1;
}

export function parseArgs(args) {
  // Sin prototipo: una flag nunca puede alcanzar `Object.prototype` ni sus métodos.
  const flags = Object.create(null);
  const positional = [];
  const warnings = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      positional.push(...args.slice(i + 1));
      break;
    }
    // Atajos de una letra: `-y` es `--yes` y `-h` es `--help` (antes `-y` acababa como posicional).
    if (SHORT_FLAGS[a]) { setFlag(flags, SHORT_FLAGS[a], true); continue; }
    if (!a.startsWith('--') || a === '-') {
      positional.push(a);
      continue;
    }
    i += parseLong(a, args[i + 1], flags, warnings);
  }
  return { flags, positional, warnings };
}
