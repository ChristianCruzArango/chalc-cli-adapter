// gallery.mjs — la galería de capturas (spec 040, R1, R2). Responsabilidad ÚNICA: componer una página estática
// con cada vista medida, su captura y sus hallazgos. Razón de cambio: qué ve quien revisa el diseño.
//
// Este archivo lo emite chalc dentro de `.chalc/design/lib/`. No edites aquí: se regenera al equipar el repo.
//
// PURO. Quien revisa el diseño, y el usuario antes de aprobar el cierre, miran pantallas de verdad y no una
// descripción. Todo lo que viene de la página —selectores, URL, nombres— se escribe como TEXTO: la galería no
// ejecuta nada ni lleva scripts.

import { messageOf, textOf } from './i18n.mjs';

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ESCAPES[char]);

const STYLE = 'body{font:15px/1.5 system-ui,sans-serif;margin:24px;color:#1a1a1a;background:#f6f6f4}h1{font-size:20px}h2{font-size:16px;margin:0 0 4px}'
  + 'section{background:#fff;border:1px solid #ddd;border-radius:8px;padding:16px;margin:16px 0}img{max-width:100%;border:1px solid #ccc;margin-top:12px}'
  + '.meta{color:#666;font-size:13px}.bad{color:#a11}.ok{color:#176b2c}li{margin:4px 0}';

function viewSection(view, findings, lang, g) {
  const own = findings.filter((finding) => finding.viewport === view.name);
  const list = own.length ? `<ul class="bad">${own.map((finding) => `<li>${esc(messageOf(finding, lang))}</li>`).join('')}</ul>` : `<p class="ok">${esc(g.clean)}</p>`;
  return `<section><h2>${esc(view.name)}</h2><div class="meta">${esc(view.width)}×${esc(view.height)} · ${esc(view.url)}</div>${list}`
    + `<img src="${esc(view.screenshot)}" alt="${esc(view.name)}"></section>`;
}

/** La galería en HTML. `measurements` es lo guardado por `measure`; `findings`, lo que dio el evaluador. */
export function galleryHtml({ measurements, findings, lang }) {
  const t = textOf(lang);
  const code = lang === 'es' ? 'es' : 'en';
  const views = Array.isArray(measurements?.viewports) ? measurements.viewports : [];
  const summary = findings.length ? `<p class="bad">${esc(t.found(findings.length))}</p>` : `<p class="ok">${esc(t.clean)}</p>`;
  return `<!doctype html><html lang="${code}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<title>${esc(t.gallery.title)}</title><style>${STYLE}</style></head><body><h1>${esc(t.gallery.title)}</h1>`
    + `<div class="meta">${esc(t.gallery.commit)}: ${esc(measurements?.commit || '—')}</div>${summary}`
    + `${views.map((view) => viewSection(view, findings, lang, t.gallery)).join('')}</body></html>\n`;
}
