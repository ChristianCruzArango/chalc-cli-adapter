// lib/userpref.mjs — lectura de preferencias de autorización del usuario (spec 016, R1 / V-01).
// Solo cuentan propiedades PROPIAS de la config local con valor `true`: un valor heredado (p. ej. por
// un prototipo contaminado desde un archivo del proyecto) nunca abre una excepción de seguridad.

export function userFlag(cfg, key) {
  if (!cfg || !Object.hasOwn(cfg, 'cli')) return false;
  const cli = cfg.cli;
  return !!cli && typeof cli === 'object' && Object.hasOwn(cli, key) && cli[key] === true;
}
