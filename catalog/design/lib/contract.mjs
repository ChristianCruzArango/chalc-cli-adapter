// contract.mjs — el contrato de diseño (spec 038, R1, R2). Responsabilidad ÚNICA: decir qué números tiene que
// cumplir una interfaz en este proyecto. Razón de cambio: qué se exige a una interfaz.
//
// Este archivo lo emite chalc dentro de `.chalc/design/lib/`. No edites aquí: ajusta `.chalc/design.contract.json`.
//
// «Que se vea bien» no se puede revisar. Esto sí: separaciones, tamaños y contraste con cifras. Lo que falta o
// no vale cae al valor por defecto —un contrato roto no deja al proyecto sin contrato—, y una spec puede
// ajustar el suyo sin tocar el de todos.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const CONTRACT_REL = '.chalc/design.contract.json';

/** El contrato cuando el proyecto no dice otra cosa. Medidas en px CSS. */
export const DEFAULT_CONTRACT = Object.freeze({
  // Los anchos en los que se mide cada pantalla.
  viewports: Object.freeze([{ name: 'movil', width: 375, height: 812 }, { name: 'tablet', width: 768, height: 1024 }, { name: 'escritorio', width: 1440, height: 900 }]),
  // Por debajo de este ancho la vista se usa con el dedo: el objetivo mínimo es el táctil.
  touchBelow: 1024,
  target: Object.freeze({ touch: 44, pointer: 24 }),
  // Separación mínima entre elementos interactivos, y la escala de la que salen los espacios.
  spacing: Object.freeze({ minGap: 8, step: 4, min: 4, max: 64, enforceScale: true }),
  typography: Object.freeze({ minSize: 12 }),
  contrast: Object.freeze({ normal: 4.5, large: 3 }),
  // Cuántas acciones principales caben en una vista: con dos, ninguna lo es.
  maxPrimary: 1
});

const positive = (value) => Number.isFinite(value) && value > 0;
const ratio = (value) => Number.isFinite(value) && value >= 1 && value <= 21;
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

// Qué vale en cada clave. Lo que no pasa su comprobación no entra.
const VALID = {
  touchBelow: positive,
  maxPrimary: (value) => Number.isInteger(value) && value >= 1,
  target: { touch: positive, pointer: positive },
  spacing: { minGap: (value) => Number.isFinite(value) && value >= 0, step: positive, min: positive, max: positive, enforceScale: (value) => typeof value === 'boolean' },
  typography: { minSize: positive },
  contrast: { normal: ratio, large: ratio }
};

const viewportOk = (view) => isObject(view) && typeof view.name === 'string' && Boolean(view.name.trim()) && positive(view.width) && positive(view.height);

// `base` con lo que `raw` declare y valga, clave por clave.
function merged(base, raw, valid) {
  const own = isObject(raw) ? raw : {};
  return Object.fromEntries(Object.entries(valid).map(([key, check]) => [key, typeof check === 'function' ? (check(own[key]) ? own[key] : base[key]) : merged(base[key], own[key], check)]));
}

function over(base, raw) {
  const views = (Array.isArray(raw?.viewports) ? raw.viewports : []).filter(viewportOk).map(({ name, width, height }) => ({ name, width, height }));
  return { viewports: views.length ? views : base.viewports, ...merged(base, raw, VALID) };
}

/** El contrato vigente: el de por defecto, ajustado por cada objeto de `raws` en orden. */
export function contractOf(...raws) {
  const start = { ...DEFAULT_CONTRACT, viewports: [...DEFAULT_CONTRACT.viewports], target: { ...DEFAULT_CONTRACT.target }, spacing: { ...DEFAULT_CONTRACT.spacing }, typography: { ...DEFAULT_CONTRACT.typography }, contrast: { ...DEFAULT_CONTRACT.contrast } };
  return raws.reduce(over, start);
}

const jsonOr = async (path) => { try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; } };

/** El contrato de `root`; con `specDir`, ajustado por el `design.contract.json` de esa carpeta. */
export async function readContract(root, specDir = '') {
  const project = await jsonOr(join(root, ...CONTRACT_REL.split('/')));
  const spec = specDir ? await jsonOr(join(root, ...specDir.split('/'), 'design.contract.json')) : null;
  return contractOf(project, spec);
}
