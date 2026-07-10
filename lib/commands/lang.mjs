// Comando `chalc lang`: fija el idioma del CLI en ~/.chalc/config.json.

import { t, lang, saveLang } from '../i18n.mjs';
import { c, flags, interactive, positional } from './context.mjs';
import { makePrompter } from './prompter.mjs';

// ---------- comando: chalc lang ----------
// Fija el idioma una sola vez en ~/.chalc/config.json; se aplica a todos los proyectos sin volver a cambiarlo.
export async function runConfigLang() {
  console.log('\n' + c.bold('⚙️  chalc lang') + '\n');
  console.log(c.dim('  ' + t('langCurrent', lang)));
  const opts = [{ label: t('langOptEs'), value: 'es' }, { label: t('langOptEn'), value: 'en' }];
  let code = String(positional[1] || flags.lang || '').slice(0, 2).toLowerCase();
  if (interactive && code !== 'es' && code !== 'en') {
    const prompter = makePrompter();
    code = opts[await prompter.select(t('langCmdQ'), opts, lang === 'en' ? 1 : 0)].value;
    prompter.close();
  }
  if (code !== 'es' && code !== 'en') code = lang;
  const path = saveLang(code);
  console.log(c.green('\n✓ ' + t('langSaved', path) + '\n'));
}
