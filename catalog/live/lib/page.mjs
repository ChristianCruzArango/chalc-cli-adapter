// page.mjs — la página del tablero (spec 020, R5, R6, R7, R13). Responsabilidad ÚNICA: armar el HTML que se
// sirve en `/`, en el idioma del proyecto. Razón de cambio: la estructura de la página.
//
// Este archivo lo emite chalc dentro de `.chalc/live/lib/`. No edites aquí: se regenera al equipar.
//
// Autocontenida: sin CDN ni recursos de fuera, porque corre en local y sin red. Los textos viven en
// `labels.mjs`, el estilo en `page-style.mjs` y el script del navegador —que pide `/state.json` cada
// `REFRESH_MS` y pinta todo como texto, nunca como HTML— en `page-script.mjs`.

import { LABELS } from './labels.mjs';
import { STYLE } from './page-style.mjs';
import { clientScript } from './page-script.mjs';

export { LABELS };
export const REFRESH_MS = 2000;

// El orden de la página (R21): a la izquierda, la barra lateral —estado del agente, specs y navegación—; a la
// derecha, a pantalla completa, el resumen y la vía SDD, el portón, gráficos y lo que falta, tareas, notas y la
// actividad. Lo que va a lo ancho lleva `wide`; gráficos y «qué falta» comparten fila.
const SECTIONS = ['headline', 'flow', 'gate', 'charts', 'missing', 'tasks', 'notes', 'activity'];
const WIDE = new Set(['headline', 'flow', 'gate', 'tasks', 'notes', 'activity']);
const NAV = ['headline', 'flow', 'gate', 'tasks', 'notes', 'activity'];

/** El HTML del tablero, en el idioma del proyecto (sin coincidencia, inglés). */
export function pageHtml(lang) {
  const code = LABELS[lang] ? lang : 'en';
  const labels = LABELS[code];
  const sections = SECTIONS.map((id) => `<section id="${id}"${WIDE.has(id) ? ' class="wide"' : ''}></section>`).join('');
  const nav = NAV.map((id) => `<a href="#${id}">${labels.sections[id]}</a>`).join('');
  return `<!doctype html><html lang="${code}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<title>${labels.title}</title><style>${STYLE}</style></head><body>`
    + `<aside id="side"><h1>${labels.title}</h1><div id="agent" class="chip"></div><div id="specs"></div>`
    + `<nav id="nav"><div class="label">${labels.sections.nav}</div>${nav}</nav><div id="updated" class="mute small"></div></aside>`
    + `<main>${sections}</main><script>${clientScript(labels, code, REFRESH_MS)}</script></body></html>`;
}
