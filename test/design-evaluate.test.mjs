// Spec 038 (contrato de diseño), T2 — el evaluador (R3, R4): recibe las medidas de una vista y dice exactamente
// qué incumple el contrato, con el selector y las cifras. «Dos botones a 2 px» deja de ser una opinión.
import test from 'node:test';
import assert from 'node:assert/strict';
import { contrastRatio, parseColor } from '../catalog/design/lib/color.mjs';
import { contains, gapBetween, overlaps } from '../catalog/design/lib/geometry.mjs';
import { evaluate } from '../catalog/design/lib/evaluate.mjs';
import { contractOf } from '../catalog/design/lib/contract.mjs';

const CONTRACT = contractOf();
const rect = (x, y, width = 100, height = 44) => ({ x, y, width, height });
const el = (selector, r, extra = {}) => ({ selector, interactive: true, primary: false, visible: true, rect: r, fontSize: 16, bold: false, color: 'rgb(0, 0, 0)', background: 'rgb(255, 255, 255)', text: selector, ...extra });
const view = (elements, extra = {}) => ({ viewports: [{ name: 'movil', width: 375, height: 812, elements, ...extra }] });
const rulesOf = (measurements, contract = CONTRACT) => evaluate(measurements, contract).map((f) => f.rule);
const only = (measurements, rule, contract = CONTRACT) => evaluate(measurements, contract).filter((f) => f.rule === rule);

test('color: rgb(), rgba() y hex se leen; lo que no es un color, null', () => {
  assert.deepEqual(parseColor('rgb(255, 0, 10)'), { r: 255, g: 0, b: 10, a: 1 });
  assert.deepEqual(parseColor('rgba(1,2,3,0.5)'), { r: 1, g: 2, b: 3, a: 0.5 });
  assert.deepEqual(parseColor('rgb(1 2 3 / 50%)'), { r: 1, g: 2, b: 3, a: 0.5 });
  assert.deepEqual(parseColor('#fff'), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(parseColor('#0A141E'), { r: 10, g: 20, b: 30, a: 1 });
  for (const bad of ['', 'transparent', 'rojo', '#12', 'rgb(1,2)', null, undefined]) assert.equal(parseColor(bad), null, String(bad));
});

test('color: el contraste es el de WCAG, simétrico', () => {
  const ratio = (a, b) => Math.round(contrastRatio(parseColor(a), parseColor(b)) * 100) / 100;
  assert.equal(ratio('#000', '#fff'), 21);
  assert.equal(ratio('#fff', '#000'), 21);
  assert.equal(ratio('#fff', '#fff'), 1);
  assert.equal(ratio('#767676', '#fff'), 4.54);
  assert.equal(ratio('#777777', '#fff'), 4.48);
});

test('geometría: separación, solape y contención', () => {
  assert.equal(gapBetween(rect(0, 0), rect(102, 0)), 2);
  assert.equal(gapBetween(rect(102, 0), rect(0, 0)), 2);
  assert.equal(gapBetween(rect(0, 0), rect(0, 50)), 6);
  assert.equal(gapBetween(rect(0, 0), rect(103, 48)), 5, 'en diagonal, la distancia entre esquinas');
  assert.equal(gapBetween(rect(0, 0), rect(50, 20)), 0);
  assert.deepEqual([overlaps(rect(0, 0), rect(50, 20)), overlaps(rect(0, 0), rect(100, 0)), overlaps(rect(0, 0), rect(99.5, 0))], [true, false, true]);
  assert.deepEqual([contains(rect(0, 0, 200, 100), rect(10, 10)), contains(rect(10, 10), rect(0, 0, 200, 100)), contains(rect(0, 0), rect(0, 0))], [true, false, true]);
});

test('R3: una vista que cumple no tiene hallazgos', () => {
  assert.deepEqual(evaluate(view([el('#guardar', rect(16, 16), { primary: true }), el('#cancelar', rect(124, 16)), el('#ayuda', rect(16, 68))]), CONTRACT), []);
  assert.deepEqual(evaluate({ viewports: [] }, CONTRACT), []);
  assert.deepEqual(evaluate({}, CONTRACT), []);
});

test('R3: dos botones a 2 px: hallazgo exacto, con los dos selectores, la separación y el mínimo', () => {
  const found = evaluate(view([el('#guardar', rect(16, 16)), el('#cancelar', rect(118, 16))]), CONTRACT);
  assert.deepEqual(found, [{ rule: 'design-interactive-too-close', viewport: 'movil', selector: '#guardar', data: { other: '#cancelar', gap: 2, min: 8, missing: 6 } }]);
});

test('R3: la separación justa en el mínimo cumple; y también se mide hacia abajo', () => {
  assert.deepEqual(rulesOf(view([el('#a', rect(16, 16)), el('#b', rect(124, 16))])), []);
  assert.deepEqual(only(view([el('#a', rect(16, 16)), el('#b', rect(16, 63))]), 'design-interactive-too-close').map((f) => f.data.gap), [3]);
});

test('R3: solo cuentan los vecinos: lo que hay más allá del más cercano no se compara', () => {
  const found = evaluate(view([el('#a', rect(0, 0)), el('#b', rect(102, 0)), el('#c', rect(204, 0))]), CONTRACT);
  assert.deepEqual(found.map((f) => [f.selector, f.data.other]), [['#a', '#b'], ['#b', '#c']]);
});

test('R3: elementos solapados', () => {
  const found = only(view([el('#a', rect(16, 16)), el('#b', rect(60, 30))]), 'design-overlap');
  assert.deepEqual(found.map((f) => [f.selector, f.data.other]), [['#a', '#b']]);
  assert.deepEqual(rulesOf(view([el('#a', rect(16, 16)), el('#b', rect(60, 30))])).includes('design-interactive-too-close'), false, 'solapado no es además «muy junto»');
});

test('R3: objetivo táctil de 44 en vistas estrechas y de 24 en escritorio', () => {
  const small = [el('#icono', rect(16, 16, 30, 30))];
  assert.deepEqual(only(view(small), 'design-target-too-small'), [{ rule: 'design-target-too-small', viewport: 'movil', selector: '#icono', data: { width: 30, height: 30, min: 44 } }]);
  assert.deepEqual(rulesOf({ viewports: [{ name: 'escritorio', width: 1440, height: 900, elements: small }] }), []);
  assert.deepEqual(only({ viewports: [{ name: 'escritorio', width: 1440, height: 900, elements: [el('#x', rect(0, 0, 20, 40))] }] }, 'design-target-too-small')[0].data, { width: 20, height: 40, min: 24 });
  assert.deepEqual(rulesOf(view([el('texto', rect(0, 0, 10, 10), { interactive: false })])), [], 'lo que no es interactivo no tiene objetivo');
});

test('R3: un espacio fuera de la escala se reporta, salvo que el contrato no la exija', () => {
  const off = view([el('#a', rect(16, 16)), el('#b', rect(126, 16))]);
  assert.deepEqual(only(off, 'design-off-scale-spacing'), [{ rule: 'design-off-scale-spacing', viewport: 'movil', selector: '#a', data: { other: '#b', gap: 10, step: 4 } }]);
  assert.deepEqual(rulesOf(off, contractOf({ spacing: { enforceScale: false } })), []);
  assert.deepEqual(rulesOf(view([el('#a', rect(16, 16)), el('#b', rect(16, 160))])), [], 'más allá del máximo de la escala ya no son vecinos de un mismo grupo');
});

test('R3: letra pequeña y contraste insuficiente; el texto grande tiene su propio mínimo', () => {
  const text = (extra) => view([el('p', rect(0, 0, 200, 60), { interactive: false, ...extra })]);
  assert.deepEqual(only(text({ fontSize: 10 }), 'design-font-too-small')[0].data, { size: 10, min: 12 });
  assert.deepEqual(only(text({ color: '#777777' }), 'design-contrast-low')[0].data, { ratio: 4.48, min: 4.5 });
  assert.deepEqual(rulesOf(text({ color: '#767676' })), []);
  assert.deepEqual(rulesOf(text({ color: '#777777', fontSize: 24 })), [], 'texto grande: basta 3:1');
  assert.deepEqual(rulesOf(text({ color: '#777777', fontSize: 19, bold: true })), []);
  assert.deepEqual(rulesOf(text({ color: '#777777', fontSize: 19 })), ['design-contrast-low']);
  assert.deepEqual(rulesOf(text({ color: 'transparent' })), [], 'sin colores legibles no se inventa un contraste');
  assert.deepEqual(rulesOf(text({ fontSize: 10, text: '   ' })), [], 'sin texto no hay letra que medir');
});

test('R3: más de un elemento primario en la vista', () => {
  const two = view([el('#a', rect(16, 16), { primary: true }), el('#b', rect(124, 16), { primary: true })]);
  assert.deepEqual(only(two, 'design-multiple-primary'), [{ rule: 'design-multiple-primary', viewport: 'movil', selector: '#a', data: { count: 2, max: 1, others: ['#b'] } }]);
  assert.deepEqual(rulesOf(two, contractOf({ maxPrimary: 2 })), []);
});

test('R3: un elemento que se sale del ancho de la vista', () => {
  assert.deepEqual(only(view([el('#tabla', rect(16, 16, 400, 44), { interactive: false })]), 'design-horizontal-overflow')[0].data, { right: 416, width: 375 });
  assert.deepEqual(only(view([el('#x', rect(-20, 16), { interactive: false })]), 'design-horizontal-overflow').length, 1);
  assert.deepEqual(rulesOf(view([el('#justo', rect(275, 16), { interactive: false })])), []);
});

test('R4: lo que no se ve no cuenta, y un elemento no se compara con el que lo contiene', () => {
  assert.deepEqual(rulesOf(view([el('#a', rect(16, 16)), el('#oculto', rect(118, 16), { visible: false })])), []);
  assert.deepEqual(rulesOf(view([el('#tarjeta', rect(0, 0, 300, 200)), el('#dentro', rect(20, 20))])), []);
});

test('R3: cada vista se evalúa por separado y el hallazgo dice en cuál', () => {
  const elements = [el('#a', rect(16, 16)), el('#b', rect(118, 16))];
  const found = evaluate({ viewports: [{ name: 'movil', width: 375, height: 812, elements }, { name: 'escritorio', width: 1440, height: 900, elements: [el('#a', rect(16, 16)), el('#b', rect(124, 16))] }] }, CONTRACT);
  assert.deepEqual(found.map((f) => f.viewport), ['movil']);
});
