// probe.mjs — la sonda que corre DENTRO de la página (spec 039, R1). Responsabilidad ÚNICA: decir, de cada
// elemento que importa, dónde está, cuánto mide, cómo se lee y qué es. Razón de cambio: qué se mide de una página.
//
// Este archivo lo emite chalc dentro de `.chalc/design/lib/`. No edites aquí: se regenera al equipar el repo.
//
// Estas funciones NO corren en Node: se envían como texto al navegador, así que solo pueden usar lo que hay en
// una página (`document`, `getComputedStyle`) y llamarse entre ellas. Las medidas salen de lo que el navegador
// pintó de verdad, no de lo que diga el código ni quien lo escribió.

/* global document, getComputedStyle */

function textNodes(el) {
  return [...el.childNodes].filter((node) => node.nodeType === 3).map((node) => node.textContent).join(' ').replace(/\s+/g, ' ').trim();
}

// Cómo se nombra el elemento: su texto o, en un campo, su etiqueta accesible, su marcador o su valor.
function labelOf(el) {
  return (textNodes(el) || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.value || '').slice(0, 60);
}

function isInteractive(el) {
  const tag = el.tagName.toLowerCase();
  if (tag === 'input') return el.getAttribute('type') !== 'hidden';
  if (tag === 'a') return el.hasAttribute('href');
  if (['button', 'select', 'textarea', 'summary'].includes(tag)) return true;
  if (['button', 'link', 'checkbox', 'radio', 'tab', 'menuitem', 'switch'].includes(el.getAttribute('role'))) return true;
  const tab = el.getAttribute('tabindex');
  return tab !== null && Number(tab) >= 0;
}

// La acción principal: marcada con `data-primary`, un botón de envío, o una clase `primary` / `btn-primary` / `…--primary`.
function isPrimary(el) {
  if (el.hasAttribute('data-primary')) return true;
  const tag = el.tagName.toLowerCase();
  if ((tag === 'button' || tag === 'input') && el.getAttribute('type') === 'submit') return true;
  return String(el.getAttribute('class') || '').split(/\s+/).some((name) => /^(btn-)?primary$/.test(name) || /--primary$/.test(name));
}

const opaque = (color) => Boolean(color) && color !== 'transparent' && !/^rgba\(.*,\s*0\s*\)$/.test(color);

// El fondo que de verdad queda detrás del texto: el del primer ancestro que pinta algo; si ninguno, blanco.
function backgroundOf(el) {
  for (let node = el; node; node = node.parentElement) {
    const color = getComputedStyle(node).backgroundColor;
    if (opaque(color)) return color;
  }
  return 'rgb(255, 255, 255)';
}

function stepOf(node) {
  const tag = node.tagName.toLowerCase();
  const same = [...node.parentElement.children].filter((child) => child.tagName === node.tagName);
  return same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(node) + 1})` : tag;
}

// Con qué encontrarlo después: su id, su `data-testid`, o el camino corto desde sus ancestros.
function selectorOf(el) {
  if (el.id) return `#${el.id}`;
  const testId = el.getAttribute('data-testid');
  if (testId) return `[data-testid="${testId}"]`;
  const steps = [];
  for (let node = el; node && node.parentElement && steps.length < 3; node = node.parentElement) steps.unshift(stepOf(node));
  return steps.join(' > ');
}

function measured(el) {
  const style = getComputedStyle(el);
  const box = el.getBoundingClientRect();
  return {
    selector: selectorOf(el), interactive: isInteractive(el), primary: isPrimary(el),
    visible: box.width > 0 && box.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0',
    rect: { x: box.x, y: box.y, width: box.width, height: box.height },
    fontSize: parseFloat(style.fontSize), bold: style.fontWeight === 'bold' || Number(style.fontWeight) >= 600,
    color: style.color, background: backgroundOf(el), text: labelOf(el)
  };
}

// Importa lo que se puede pulsar y lo que tiene texto propio. Las cajas que solo agrupan no se miden.
function collect() {
  return [...document.body.querySelectorAll('*')].filter((el) => isInteractive(el) || Boolean(textNodes(el))).slice(0, 2000).map(measured);
}

const PIECES = [textNodes, labelOf, isInteractive, isPrimary, backgroundOf, stepOf, selectorOf, measured, collect];

/** La expresión que se evalúa en la página: devuelve la lista de elementos medidos. */
export const PROBE = `(() => {\nconst opaque = ${opaque.toString()};\n${PIECES.map(String).join('\n')}\nreturn collect();\n})()`;
