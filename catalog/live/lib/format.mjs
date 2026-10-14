// format.mjs — cómo se leen los números del tablero (spec 020, R12, R13). Responsabilidad ÚNICA: duraciones,
// tokens y «hace cuánto», en las palabras de cada idioma. Razón de cambio: cómo se presentan esas cifras.
//
// Este archivo lo emite chalc dentro de `.chalc/live/lib/`. No edites aquí: se regenera al equipar.
//
// Estas funciones viajan DENTRO de la página (`page.mjs` las inserta con `toString()`), así que cada una se
// basta sola: sin imports ni nada de fuera, salvo `durationText`, que va con ellas. Así se prueban aquí y el
// navegador corre exactamente lo probado.

/** Una duración legible: `4 min 30 s`, `1 h 5 min`; sin duración, `—`. */
export function durationText(ms, w) {
  if (!(ms > 0)) return '—';
  const total = Math.max(1, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h} ${w.h}${m ? ` ${m} ${w.min}` : ''}`;
  if (m) return `${m} ${w.min}${s ? ` ${s} ${w.s}` : ''}`;
  return `${s} ${w.s}`;
}

/** Tokens en corto y con el formato del idioma: `12.3K`, `12,3 mil`. */
export function tokensText(n, lang) {
  return new Intl.NumberFormat(lang, { notation: 'compact', maximumFractionDigits: 1 }).format(Number.isFinite(n) ? n : 0);
}

/** «Hace cuánto» de una fecha ISO respecto de `now`; '' si no hay fecha legible. */
export function agoText(iso, now, w) {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return '';
  if (now - at < 10_000) return w.justNow;
  return w.ago.replace('{t}', durationText(now - at, w));
}
