// lib/commands/storyinput.mjs — la ENTRADA común de los flujos de spec: de dónde viene la historia de
// usuario y en qué idioma se escribe el spec. Vive aparte para que los comandos (spec-ia, feature,
// worktree, debate) la reutilicen sin importarse entre sí: antes specgen ↔ feature ↔ featureworktree
// formaban un ciclo de imports (M-01). No importa ningún comando.

import { resolve } from 'node:path';
import { t, lang, languageName } from '../i18n.mjs';
import { readDocument } from '../docread.mjs';
import { fetchAzureDevOps, fetchJira, fetchUrl } from '../sources.mjs';
import { c, cleanPath, flags } from './context.mjs';
import { readPasted } from './prompter.mjs';

const langName = languageName;

// Fuentes reales de la historia. Se inyectan (`io`) para probar cada camino sin red, disco ni stdin.
const SOURCES = { readDocument, fetchAzureDevOps, fetchJira, fetchUrl, readPasted };

// Obtiene el texto de la HU/documento desde la fuente elegida (interactivo o por flags). Reusado por spec-ia y feature.
// `opts` son los flags de la línea de comandos y `env` el entorno; por defecto, los del proceso.
export async function acquireUserStory(prompter, { opts = flags, env = process.env, io = SOURCES, log = console.log } = {}) {
  if (prompter) {
    const sources = [
      { v: 'file', label: t('srcFile') }, { v: 'azure', label: t('srcAzure') },
      { v: 'jira', label: t('srcJira') }, { v: 'url', label: t('srcUrl') }, { v: 'paste', label: t('srcPaste') }
    ];
    const src = sources[await prompter.select(t('sourceQ'), sources.map((s) => ({ label: s.label })), 0)].v;
    if (src === 'file') return io.readDocument(resolve(cleanPath(await prompter.text(t('docQ') + ':'))));
    if (src === 'paste') { log(c.dim('  ' + t('pasteQ'))); return io.readPasted(); }
    if (src === 'azure') {
      const url = await prompter.text(t('azureUrlQ') + ':'); const pat = await prompter.secret(t('patQ') + ':');
      log(c.dim('  ' + t('fetching'))); return io.fetchAzureDevOps({ url, pat });
    }
    if (src === 'jira') {
      const url = await prompter.text(t('jiraUrlQ') + ':'); const email = await prompter.text(t('emailQ') + ':'); const token = await prompter.secret(t('tokenQ') + ':');
      log(c.dim('  ' + t('fetching'))); return io.fetchJira({ url, email, token });
    }
    const url = await prompter.text(t('urlQ') + ':'); log(c.dim('  ' + t('fetching'))); return io.fetchUrl(url);
  }
  if (opts.doc) return io.readDocument(resolve(cleanPath(String(opts.doc))));
  if (opts.azure) return io.fetchAzureDevOps({ url: String(opts.azure), pat: String(opts.pat || env.CHALC_PAT || '') });
  if (opts.jira) return io.fetchJira({ url: String(opts.jira), email: String(opts.email || ''), token: String(opts.token || env.CHALC_TOKEN || '') });
  if (opts.url) return io.fetchUrl(String(opts.url));
  return '';
}

// Idioma del SPEC (el del proyecto), independiente del idioma del CLI. Por flag o preguntando.
// `uiLang` es el idioma de la interfaz: el valor por defecto de la pregunta y el de respaldo.
export async function askSpecLang(prompter, { opts = flags, uiLang = lang } = {}) {
  let specLang = opts.lang ? langName(String(opts.lang)) : null;
  if (prompter && !specLang) {
    const optsL = [{ label: 'Español', value: 'español' }, { label: 'English', value: 'English' }, { label: t('otherLang'), value: '__other' }];
    const idx = await prompter.select(t('specLangQ'), optsL.map((o) => ({ label: o.label })), uiLang === 'en' ? 1 : 0);
    specLang = optsL[idx].value;
    if (specLang === '__other') specLang = (await prompter.text(t('otherLangQ') + ':')).trim() || langName(uiLang);
  }
  return specLang || langName(uiLang);
}
