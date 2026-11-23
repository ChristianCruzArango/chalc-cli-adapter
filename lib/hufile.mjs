// lib/hufile.mjs — el `hu.md` de una spec a partir de la HU que entregó el usuario (spec 024, R27, R28).
// Responsabilidad ÚNICA: rellenar la plantilla con el origen y el texto LITERAL. Razón de cambio: el formato
// de `hu.md`. Puro: no lee disco ni red, y no usa ningún modelo.
//
// La HU nace fuera del repo. Copiada tal cual, con de dónde vino, todo lo demás se puede comparar contra ella
// sin que nadie la haya resumido o «mejorado» por el camino. Los fragmentos `HU-n` los declara después quien
// redacta la spec; aquí no se interpreta el texto.

import { basename } from 'node:path';

const SOURCE_LINE = /^(Fuente|Source)[ \t]*:.*$/m;
// El hueco del texto: una línea que es solo un marcador `<…>`. La del origen y la de los fragmentos llevan
// algo delante, así que no casan.
const TEXT_SLOT = /^<[^<>\n]*>[ \t]*$/m;
const TITLE_SLOT = /^(#[^<\n]*)<[^<>\n]*>/;
const STORY_FLAGS = ['doc', 'azure', 'jira', 'url'];
const TITLE_MAX = 60;

const unix = (text) => String(text ?? '').replace(/\r\n/g, '\n');
const trimmedEnd = (text) => text.replace(/\s+$/, '');

/** ¿Los flags traen una fuente de la que leer la HU? */
export const hasStorySource = (opts) => STORY_FLAGS.some((key) => Boolean(opts[key]));

/** Cómo se anota el origen: el nombre del archivo o la URL sin usuario ni clave. Nunca un token. */
export function sourceLabel(opts) {
  if (opts.doc) return basename(String(opts.doc));
  return String(opts.azure || opts.jira || opts.url || '').replace(/^(https?:\/\/)[^/@]*@/, '$1');
}

/** Un título corto para la HU: su primera línea con texto, sin almohadillas. */
export function titleOf(text) {
  const first = unix(text).split('\n').map((line) => line.replace(/^[#\s]+/, '').replace(/\s+/g, ' ').trim()).find(Boolean);
  return (first || '').slice(0, TITLE_MAX);
}

/** `hu.md`: la plantilla con `source` en su línea de origen y `text` tal cual en el hueco del texto. */
export function renderHu({ template = '', text, source, title = '' }) {
  const body = trimmedEnd(unix(text));
  let out = unix(template);
  if (title) out = out.replace(TITLE_SLOT, (_, head) => head + title);
  // Las funciones de reemplazo evitan que un `$&` o un `$1` del texto de la HU se interprete como patrón.
  out = SOURCE_LINE.test(out)
    ? out.replace(SOURCE_LINE, (_, label) => `${label}: ${source}`)
    : `${trimmedEnd(out)}\n\nFuente: ${source}\n`.replace(/^\n+/, '');
  return TEXT_SLOT.test(out) ? out.replace(TEXT_SLOT, () => body) : `${trimmedEnd(out)}\n\n${body}\n`;
}
