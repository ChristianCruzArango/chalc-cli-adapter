// geometry.mjs — rectángulos en pantalla (spec 038, R3, R4). Responsabilidad ÚNICA: decir cuánto se separan, si
// se pisan y si uno contiene a otro. Razón de cambio: cómo se mide una separación.
//
// Este archivo lo emite chalc dentro de `.chalc/design/lib/`. No edites aquí: se regenera al equipar el repo.
//
// PURO. Un rectángulo es `{ x, y, width, height }` en px CSS, como lo da `getBoundingClientRect`.

const right = (r) => r.x + r.width;
const bottom = (r) => r.y + r.height;
// Cuánto se separan en un eje: 0 si sus proyecciones se tocan o se pisan.
const apart = (aStart, aEnd, bStart, bEnd) => Math.max(0, aStart - bEnd, bStart - aEnd);

/** La separación entre dos rectángulos: sobre el eje que comparten, o entre esquinas si están en diagonal. */
export function gapBetween(a, b) {
  const dx = apart(a.x, right(a), b.x, right(b));
  const dy = apart(a.y, bottom(a), b.y, bottom(b));
  return dx && dy ? Math.hypot(dx, dy) : dx || dy;
}

/** ¿Se pisan? Tocarse por un borde no es pisarse. */
export const overlaps = (a, b) => a.x < right(b) && b.x < right(a) && a.y < bottom(b) && b.y < bottom(a);

/** ¿Está `inner` entero dentro de `outer`? */
export const contains = (outer, inner) => inner.x >= outer.x && inner.y >= outer.y && right(inner) <= right(outer) && bottom(inner) <= bottom(outer);

/** ¿Comparten fila (sus proyecciones verticales se pisan)? */
export const sameRow = (a, b) => a.y < bottom(b) && b.y < bottom(a);
/** ¿Comparten columna (sus proyecciones horizontales se pisan)? */
export const sameColumn = (a, b) => a.x < right(b) && b.x < right(a);
/** Cuánto queda `b` a la derecha de `a` (negativo si no lo está). */
export const toRight = (a, b) => b.x - right(a);
/** Cuánto queda `b` debajo de `a` (negativo si no lo está). */
export const below = (a, b) => b.y - bottom(a);
