const SAFE_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

import { t } from './i18n.mjs';
export function isSafeId(value) {
  return typeof value === 'string' && SAFE_ID_RE.test(value);
}

export function assertSafeId(value, label = 'id') {
  const id = String(value || '');
  if (!isSafeId(id)) {
    throw new Error(t('idInvalid', label, id));
  }
  return id;
}
