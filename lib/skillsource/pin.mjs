// lib/skillsource/pin.mjs — fuente git fijada a un commit: `<url>@<sha>` (S6). Con el commit fijo,
// `chalc update` solo trae cambios cuando el usuario mueve el pin a propósito.

const PIN = /^(\S+?)@([0-9a-f]{7,40})$/i;

// Devuelve { base, pin }; pin = null si la fuente no termina en `@<sha>`. `git@host:…` no es un pin.
export function splitPin(source) {
  const m = String(source).match(PIN);
  if (!m || /^[^/:]*$/.test(m[1])) return { base: String(source), pin: null };
  return { base: m[1], pin: m[2].toLowerCase() };
}
