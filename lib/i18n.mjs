// lib/i18n.mjs — textos del CLI según el idioma elegido por el usuario o el del sistema operativo.
// Precedencia del idioma de la INTERFAZ: CHALC_LANG  >  config guardada (~/.chalc/config.json, `chalc lang`)
// >  LANG/LC_*  >  'en'. La flag `--lang` NO cambia la interfaz: en `spec-ia` y `feature` es el idioma de
// la spec, independiente del de la CLI (así lo documenta el README).
// El usuario fija el idioma una sola vez con `chalc lang`; queda guardado y no hay que cambiarlo cada vez.

import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { writeSecureFileSync } from './securefile.mjs';
import { readJsonOrKeepSync, setUserdataNotices } from './userdata.mjs';
import esCore from './i18n/es/core.mjs';
import esDocs from './i18n/es/docs.mjs';
import esQa from './i18n/es/qa.mjs';
import esCommands from './i18n/es/commands.mjs';
import esDebate from './i18n/es/debate.mjs';
import esErrors from './i18n/es/errors.mjs';
import enCore from './i18n/en/core.mjs';
import enDocs from './i18n/en/docs.mjs';
import enQa from './i18n/en/qa.mjs';
import enCommands from './i18n/en/commands.mjs';
import enDebate from './i18n/en/debate.mjs';
import enErrors from './i18n/en/errors.mjs';

const CONFIG_PATH = join(homedir(), '.chalc', 'config.json');

function readSavedLang() {
  try {
    if (existsSync(CONFIG_PATH)) return JSON.parse(readFileSync(CONFIG_PATH, 'utf8')).lang || null;
  } catch { /* config corrupta: se ignora */ }
  return null;
}

// Guarda el idioma elegido en ~/.chalc/config.json sin tocar el resto de la config (API key, etc.).
export function saveLang(code) {
  const cfg = readJsonOrKeepSync(CONFIG_PATH, {});   // corrupta: se respalda antes de reescribirla
  cfg.lang = code;
  writeSecureFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n');
  return CONFIG_PATH;
}

export const DICT = {
  es: { ...esCore, ...esDocs, ...esQa, ...esCommands, ...esDebate, ...esErrors },
  en: { ...enCore, ...enDocs, ...enQa, ...enCommands, ...enDebate, ...enErrors }
};

export function detectLang(override) {
  const raw = override || process.env.CHALC_LANG || readSavedLang() || process.env.LC_ALL
    || process.env.LC_MESSAGES || process.env.LANG || process.env.LANGUAGE || '';
  let code = raw.split(/[._-]/)[0].toLowerCase();
  if (!code) {
    try { code = (Intl.DateTimeFormat().resolvedOptions().locale || '').split('-')[0].toLowerCase(); } catch { /* ignore */ }
  }
  return DICT[code] ? code : 'en';
}

export const lang = detectLang();

// Los avisos de respaldo de userdata.mjs, en el idioma de la interfaz (ver allí por qué se registran).
setUserdataNotices({
  invalid: (file, why, backup) => t('udInvalid', file, why, backup),
  backedUp: (file, reason, backup) => t('udBackedUp', file, t('udWhy_' + reason), backup)
});

export function t(key, ...args) {
  const entry = (DICT[lang] && DICT[lang][key]) ?? DICT.en[key] ?? key;
  return typeof entry === 'function' ? entry(...args) : entry;
}

// Nombre del idioma para pedirle a un modelo que escriba EN ese idioma ("español", "English").
// Vive aquí —y no en el comando que lo estrenó— porque ya lo usan spec-ia, el orquestador full-stack
// y el debate: es una propiedad del idioma, no de ninguno de los tres.
const LANGUAGE_NAMES = { es: 'español', en: 'English', pt: 'português', fr: 'français', de: 'Deutsch', it: 'italiano' };

export function languageName(code) {
  return LANGUAGE_NAMES[String(code).toLowerCase()] || code;
}
