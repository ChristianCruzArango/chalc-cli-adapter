// i18n.mjs — los mensajes del contrato de diseño en es y en (spec 038, R5). Responsabilidad ÚNICA: escribir cada
// hallazgo con su arreglo. Razón de cambio: la redacción. Paridad exacta de claves: el test la exige.
//
// Este archivo lo emite chalc dentro de `.chalc/design/lib/`. No edites aquí: se regenera al equipar el repo.
//
// Un hallazgo dice QUÉ elemento, EN QUÉ vista, CUÁNTO mide y CUÁNTO pide el contrato: quien lo lee sabe qué
// cambiar sin abrir un navegador.

import { DESIGN_RULES as R } from './evaluate.mjs';

export const MESSAGES = {
  es: {
    usage: 'Uso: node .chalc/design.mjs measure <url…> [--spec <carpeta>] [--allow-remote] | check <medidas.json> [--spec <carpeta>] | contract [--spec <carpeta>]',
    savedIn: (dir) => `Medidas y capturas en ${dir}/ (measurements.json, un PNG por vista y la galería gallery.html).`,
    gallery: { title: 'Galería de la interfaz medida', commit: 'Commit medido', clean: 'Sin hallazgos en esta vista.' },
    noBrowser: 'No se pudo medir: esta máquina no tiene Chrome, Edge ni Chromium (CHALC_BROWSER puede nombrar otro). Sin medir, la interfaz no está aprobada.',
    notLocal: (url) => `No se pudo medir: ${url} no es una página de esta máquina (localhost, 127.0.0.1, [::1] o file:). Para medirla igualmente, añade --allow-remote.`,
    measureFailed: (detail) => `No se pudo medir: ${detail}`,
    clean: 'Diseño: las medidas cumplen el contrato.',
    found: (count) => `Diseño: ${count} hallazgo(s) contra el contrato (.chalc/design.contract.json).`,
    unreadable: (file) => `No se pudieron leer las medidas de ${file}: se espera un JSON con «viewports».`,
    rules: {
      [R.tooClose]: (d) => `está a ${d.gap} px de «${d.other}»; el contrato pide al menos ${d.min} px. Sepáralos ${d.missing} px más.`,
      [R.overlap]: (d) => `se pisa con «${d.other}». Dos elementos interactivos no pueden ocupar el mismo sitio.`,
      [R.target]: (d) => `mide ${d.width}×${d.height} px; el objetivo mínimo en esta vista es ${d.min}×${d.min} px. Agranda el área pulsable.`,
      [R.offScale]: (d) => `está a ${d.gap} px de «${d.other}»; los espacios salen de la escala de ${d.step} px. Usa un múltiplo de ${d.step}.`,
      [R.font]: (d) => `tiene letra de ${d.size} px; el mínimo es ${d.min} px.`,
      [R.contrast]: (d) => `tiene un contraste de ${d.ratio}:1 entre texto y fondo; el mínimo es ${d.min}:1. Oscurece el texto o aclara el fondo.`,
      [R.primary]: (d) => `es uno de ${d.count} elementos primarios en la vista (con ${d.others.map((o) => `«${o}»`).join(', ')}); caben ${d.max}. Deja uno como acción principal.`,
      [R.overflow]: (d) => `llega hasta ${d.right} px en una vista de ${d.width} px de ancho: se sale. Hazlo caber o que se adapte.`
    }
  },
  en: {
    usage: 'Usage: node .chalc/design.mjs measure <url…> [--spec <folder>] [--allow-remote] | check <measurements.json> [--spec <folder>] | contract [--spec <folder>]',
    savedIn: (dir) => `Measurements and screenshots in ${dir}/ (measurements.json, one PNG per view and the gallery.html gallery).`,
    gallery: { title: 'Gallery of the measured interface', commit: 'Measured commit', clean: 'No findings in this view.' },
    noBrowser: 'Could not measure: this machine has no Chrome, Edge or Chromium (CHALC_BROWSER can name another). Without measuring, the interface is not approved.',
    notLocal: (url) => `Could not measure: ${url} is not a page on this machine (localhost, 127.0.0.1, [::1] or file:). To measure it anyway, add --allow-remote.`,
    measureFailed: (detail) => `Could not measure: ${detail}`,
    clean: 'Design: the measurements meet the contract.',
    found: (count) => `Design: ${count} finding(s) against the contract (.chalc/design.contract.json).`,
    unreadable: (file) => `The measurements in ${file} could not be read: a JSON with "viewports" is expected.`,
    rules: {
      [R.tooClose]: (d) => `is ${d.gap} px from "${d.other}"; the contract asks for at least ${d.min} px. Move them ${d.missing} px further apart.`,
      [R.overlap]: (d) => `overlaps "${d.other}". Two interactive elements cannot take the same place.`,
      [R.target]: (d) => `measures ${d.width}×${d.height} px; the minimum target in this view is ${d.min}×${d.min} px. Enlarge the tappable area.`,
      [R.offScale]: (d) => `is ${d.gap} px from "${d.other}"; spaces come from the ${d.step} px scale. Use a multiple of ${d.step}.`,
      [R.font]: (d) => `has ${d.size} px text; the minimum is ${d.min} px.`,
      [R.contrast]: (d) => `has a contrast of ${d.ratio}:1 between text and background; the minimum is ${d.min}:1. Darken the text or lighten the background.`,
      [R.primary]: (d) => `is one of ${d.count} primary elements in the view (with ${d.others.map((o) => `"${o}"`).join(', ')}); ${d.max} fit. Leave one as the main action.`,
      [R.overflow]: (d) => `reaches ${d.right} px in a view ${d.width} px wide: it overflows. Make it fit or adapt.`
    }
  }
};

/** Los textos de `lang`; un idioma desconocido cae al inglés. */
export const textOf = (lang) => MESSAGES[lang] || MESSAGES.en;

/** Un hallazgo escrito para una persona: `[vista] «selector» …arreglo`. Una regla sin mensaje sale con su id. */
export function messageOf(finding, lang) {
  const write = textOf(lang).rules[finding.rule];
  return `[${finding.viewport}] «${finding.selector}» ${write ? write(finding.data || {}) : finding.rule}`;
}
