// lib/skillsource/urlcreds.mjs — credenciales embebidas en la URL de una fuente de skills (S9).
// Un `https://user:token@host/…` acababa en la consola, en `.chalc-skill.json` y en `skills-lock.json`
// (que se publica). Se rechaza al instalar —el usuario debe usar un credential helper de git— y lo
// heredado se limpia antes de mostrarlo o persistirlo.

import { t } from '../i18n.mjs';

const URL_TOKEN = /[a-z][a-z0-9+.-]*:\/\/[^\s"']+/gi;

const parse = (raw) => { try { return new URL(raw); } catch { return null; } };

// http(s) con cualquier usuario es credencial (un token suele ir como usuario); en ssh:// el usuario
// (`git`) no es secreto, la contraseña sí.
function carriesSecret(u) {
  if (!u) return false;
  if (/^https?:$/.test(u.protocol)) return Boolean(u.username || u.password);
  return Boolean(u.password);
}

export const hasUrlCredentials = (source) =>
  [...String(source).matchAll(URL_TOKEN)].some(([raw]) => carriesSecret(parse(raw)));

export function assertNoUrlCredentials(source) {
  if (hasUrlCredentials(source)) throw new Error(t('instUrlCredentials'));
}

// La misma fuente sin `usuario:contraseña@`, para mostrarla o escribirla en el lock.
export const stripUrlCredentials = (source) =>
  String(source ?? '').replace(URL_TOKEN, (raw) => {
    const u = parse(raw);
    if (!carriesSecret(u)) return raw;
    return raw.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^@/]*@/i, '$1');
  });
