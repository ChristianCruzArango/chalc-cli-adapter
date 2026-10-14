// test/helpers/envkey.mjs — lee una variable de entorno sin distinguir mayúsculas (spec 022, R20).
// Responsabilidad ÚNICA: en Windows el entorno conserva el nombre real (`Path`, no `PATH`); un objeto
// copiado de process.env pierde la búsqueda insensible que Windows aplica al lanzar el proceso.

/** Valor de `name` en `env`, buscando el nombre sin distinguir mayúsculas. */
export function envValue(env, name) {
  const key = Object.keys(env).find((k) => k.toUpperCase() === name.toUpperCase());
  return key === undefined ? undefined : env[key];
}
