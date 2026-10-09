// lib/contentlang.mjs — el idioma del CONTENIDO que chalc escribe en un proyecto (bloques del asistente,
// reglas, hand-off), a partir del idioma del spec. Es el ÚNICO normalizador (M-05): antes `blockText`
// decidía con startsWith('es') —«Spanish» o «castellano» salían en inglés— y `handoffLang` con su propia
// regla. El texto de la CONSOLA no pasa por aquí: va por t(), en el idioma de la interfaz.

import { lang } from './i18n.mjs';

// Español en cualquiera de sus formas habituales: código (`es`, `es-MX`) o nombre («español», «Spanish»,
// «castellano»). Ojo: «estonian» empieza por «es» y no es español; por eso no basta con startsWith.
const SPANISH = /^es(?:[-_].*)?$|espa|spanish|castell/;

// → 'es' | 'en'. Sin idioma de spec, el de la interfaz (`uiLang`); cualquier otro idioma, inglés.
export function contentLang(specLang, uiLang = lang) {
  const code = String(specLang ?? '').trim().toLowerCase();
  if (!code) return uiLang === 'es' ? 'es' : 'en';
  return SPANISH.test(code) ? 'es' : 'en';
}
