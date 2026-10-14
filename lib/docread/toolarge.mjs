// lib/docread/toolarge.mjs — el error "documento demasiado grande" de los lectores de documentos.
// Lleva `code` para reconocerlo sin comparar el mensaje: el mensaje va traducido y depende del idioma.

import { t } from '../i18n.mjs';

export const DOC_TOO_LARGE = 'DOC_TOO_LARGE';

export function docTooLarge() {
  const err = new Error(t('docTooLarge'));
  err.code = DOC_TOO_LARGE;
  return err;
}

export const isDocTooLarge = (err) => err?.code === DOC_TOO_LARGE;
