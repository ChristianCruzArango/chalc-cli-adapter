// evaluate.mjs — el evaluador del contrato de diseño (spec 038, R3, R4). Responsabilidad ÚNICA: comparar las
// medidas de cada vista con el contrato y decir qué lo incumple. Razón de cambio: qué reglas se miden.
//
// Este archivo lo emite chalc dentro de `.chalc/design/lib/`. No edites aquí: ajusta `.chalc/design.contract.json`.
//
// PURO: no abre un navegador ni lee disco; recibe las medidas ya tomadas. Cada hallazgo lleva la vista, el
// selector y las cifras, para que el arreglo sea exacto y no una opinión. Solo mide lo que está en las medidas.

import { contrastRatio, over, parseColor } from './color.mjs';
import { below, contains, overlaps, sameColumn, sameRow, toRight } from './geometry.mjs';

export const DESIGN_RULES = Object.freeze({
  tooClose: 'design-interactive-too-close', overlap: 'design-overlap', target: 'design-target-too-small', offScale: 'design-off-scale-spacing',
  font: 'design-font-too-small', contrast: 'design-contrast-low', primary: 'design-multiple-primary', overflow: 'design-horizontal-overflow'
});

const round = (value) => Math.round(value * 100) / 100;
// Texto grande para WCAG: 24 px, o 18.66 px en negrita.
const isLarge = (el) => el.fontSize >= 24 || (el.bold === true && el.fontSize >= 18.66);
const hasText = (el) => Boolean(String(el.text ?? '').trim());

// El contraste del texto de `el`, si se puede medir: sin un fondo opaco conocido no se inventa.
function contrastFinding(el, contract) {
  const [fg, bg] = [parseColor(el.color), parseColor(el.background)];
  if (!fg || !bg || bg.a !== 1) return [];
  const [ratio, needed] = [round(contrastRatio(over(fg, bg), bg)), isLarge(el) ? contract.contrast.large : contract.contrast.normal];
  return ratio < needed ? [[DESIGN_RULES.contrast, { ratio, min: needed }]] : [];
}

// Lo que se comprueba de UN elemento, sin mirar a los demás.
function ownFindings(el, view, contract) {
  const found = [];
  const min = view.width < contract.touchBelow ? contract.target.touch : contract.target.pointer;
  if (el.interactive && (el.rect.width < min || el.rect.height < min)) found.push([DESIGN_RULES.target, { width: round(el.rect.width), height: round(el.rect.height), min }]);
  const right = el.rect.x + el.rect.width;
  if (right > view.width + 1 || el.rect.x < -1) found.push([DESIGN_RULES.overflow, { right: round(right), width: view.width }]);
  if (!hasText(el)) return found;
  if (el.fontSize < contract.typography.minSize) found.push([DESIGN_RULES.font, { size: el.fontSize, min: contract.typography.minSize }]);
  return [...found, ...contrastFinding(el, contract)];
}

// ¿Se pueden comparar como vecinos? No, si uno contiene al otro (un enlace dentro de una tarjeta que también lo es).
const related = (a, b) => !contains(a.rect, b.rect) && !contains(b.rect, a.rect);

// El más cercano a `el` en una dirección, entre los que comparten fila o columna con él.
function nearest(el, others, { shares, distance }) {
  const candidates = others.filter((o) => shares(el.rect, o.rect) && distance(el.rect, o.rect) >= 0).map((o) => ({ other: o, gap: round(distance(el.rect, o.rect)) }));
  return candidates.sort((a, b) => a.gap - b.gap)[0] || null;
}

const DIRECTIONS = [{ shares: sameRow, distance: toRight }, { shares: sameColumn, distance: below }];
const offScale = (gap, step) => Math.abs(gap / step - Math.round(gap / step)) > 0.01;

// La separación con el vecino `near`: demasiado junto, o fuera de la escala de espaciado.
function spacingFinding(near, spacing) {
  if (!near || near.gap > spacing.max) return [];
  if (near.gap < spacing.minGap) return [[DESIGN_RULES.tooClose, { other: near.other.selector, gap: near.gap, min: spacing.minGap, missing: round(spacing.minGap - near.gap) }]];
  return spacing.enforceScale && offScale(near.gap, spacing.step) ? [[DESIGN_RULES.offScale, { other: near.other.selector, gap: near.gap, step: spacing.step }]] : [];
}

// Lo que se comprueba entre un elemento interactivo y los demás: solape con los que vienen después, y vecinos.
function pairFindings(el, { later, all }, spacing) {
  const overlapping = later.filter((o) => overlaps(el.rect, o.rect)).map((o) => [DESIGN_RULES.overlap, { other: o.selector }]);
  const free = all.filter((o) => o !== el && !overlaps(el.rect, o.rect));
  return [...overlapping, ...DIRECTIONS.flatMap((direction) => spacingFinding(nearest(el, free, direction), spacing))];
}

function viewFindings(view, contract) {
  const visible = (Array.isArray(view.elements) ? view.elements : []).filter((el) => el && el.visible !== false && el.rect);
  const interactive = visible.filter((el) => el.interactive);
  const finding = (el) => ([rule, data]) => ({ rule, viewport: view.name, selector: el.selector, data });
  const found = visible.flatMap((el) => ownFindings(el, view, contract).map(finding(el)));
  interactive.forEach((el, index) => {
    const all = interactive.filter((o) => related(el, o));
    found.push(...pairFindings(el, { later: all.filter((o) => interactive.indexOf(o) > index), all }, contract.spacing).map(finding(el)));
  });
  const primary = visible.filter((el) => el.primary);
  if (primary.length > contract.maxPrimary) found.push(finding(primary[0])([DESIGN_RULES.primary, { count: primary.length, max: contract.maxPrimary, others: primary.slice(1).map((el) => el.selector) }]));
  return found;
}

/** Los hallazgos de `measurements` (`{ viewports: [{ name, width, height, elements }] }`) contra `contract`. */
export function evaluate(measurements, contract) {
  const views = Array.isArray(measurements?.viewports) ? measurements.viewports : [];
  return views.flatMap((view) => viewFindings(view, contract));
}
