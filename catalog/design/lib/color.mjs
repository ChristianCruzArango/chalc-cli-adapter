// color.mjs — colores y contraste (spec 038, R3). Responsabilidad ÚNICA: leer un color CSS ya calculado y dar el
// contraste entre dos. Razón de cambio: qué formatos de color se entienden.
//
// Este archivo lo emite chalc dentro de `.chalc/design/lib/`. No edites aquí: se regenera al equipar el repo.
//
// PURO. El navegador entrega los colores calculados como `rgb()`/`rgba()`; también se acepta hex. Lo que no se
// entiende devuelve null: sin color legible no se inventa un contraste.

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const RGB = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i;

const alphaOf = (raw) => (raw === undefined ? 1 : raw.endsWith('%') ? Number(raw.slice(0, -1)) / 100 : Number(raw));

function fromHex(digits) {
  const full = digits.length === 3 ? [...digits].map((d) => d + d).join('') : digits;
  return { r: parseInt(full.slice(0, 2), 16), g: parseInt(full.slice(2, 4), 16), b: parseInt(full.slice(4, 6), 16), a: 1 };
}

/** `{ r, g, b, a }` de un color CSS (`rgb()`, `rgba()`, `#rgb`, `#rrggbb`), o null si no lo es. */
export function parseColor(value) {
  const text = String(value ?? '').trim();
  const hex = HEX.exec(text);
  if (hex) return fromHex(hex[1]);
  const rgb = RGB.exec(text);
  return rgb ? { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]), a: alphaOf(rgb[4]) } : null;
}

// La luminancia relativa de WCAG 2.
const channel = (value) => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const luminance = ({ r, g, b }) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

/** `fg` pintado sobre `bg` opaco: el color que de verdad se ve cuando el texto es translúcido. */
export const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });

/** El contraste WCAG entre dos colores opacos: de 1 (iguales) a 21 (negro sobre blanco). */
export function contrastRatio(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}
