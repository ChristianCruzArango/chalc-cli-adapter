const SAFE_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

export function isSafeId(value) {
  return typeof value === 'string' && SAFE_ID_RE.test(value);
}

export function assertSafeId(value, label = 'id') {
  const id = String(value || '');
  if (!isSafeId(id)) {
    throw new Error(`${label} inválido "${id}". Usa kebab-case ASCII: letras minúsculas, números y guiones.`);
  }
  return id;
}
