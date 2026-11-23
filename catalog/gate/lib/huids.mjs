// huids.mjs — lectura de `hu.md` (spec 024, R3, R22). Responsabilidad ÚNICA: separar el origen, el texto de la
// HU y sus fragmentos trazables `HU-n`. Razón de cambio: el formato de `hu.md`.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// La HU nace fuera del repo. Copiada tal cual y con ids que apuntan a fragmentos LITERALES, se puede comprobar
// sin IA que la spec no inventó nada: un id no puede apuntar a algo que la HU no dice.

import { linesOf } from './specparse.mjs';

const SOURCE = /^\s*(?:Fuente|Source)\s*:(.*)$/i;
const ID_LINE = /^\s*[-*]\s+\*\*(HU-\d+)\*\*\s*[—–:-]*(.*)$/;
const HEADING = /^\s*#/;
const QUOTES = [['"', '"'], ['«', '»'], ['“', '”'], ["'", "'"]];

// Los comentarios no son contenido; se vacían conservando los saltos para no mover los números de línea.
const withoutComments = (text) => String(text).replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, ''));
// Un marcador de plantilla sin rellenar (`<pega aquí…>`) tampoco es contenido.
const withoutPlaceholders = (text) => text.replace(/<[^<>\n]*>/g, '');
const squashed = (text) => text.replace(/\s+/g, ' ').trim();

function unquoted(text) {
  const pair = QUOTES.find(([open, close]) => text.length > 1 && text.startsWith(open) && text.endsWith(close));
  return pair ? text.slice(1, -1) : text;
}

/** { source, body, fragments: [{ id, line, fragment }] } de un `hu.md`. `body` excluye las líneas de ids. */
export function parseHu(text) {
  const facts = { source: '', fragments: [], bodyLines: [] };
  linesOf(withoutComments(text)).forEach((raw, index) => {
    const source = SOURCE.exec(raw);
    const id = ID_LINE.exec(raw);
    if (source) facts.source = facts.source || squashed(withoutPlaceholders(source[1]));
    else if (id) facts.fragments.push({ id: id[1], line: index + 1, fragment: squashed(unquoted(squashed(withoutPlaceholders(id[2])))) });
    else if (!HEADING.test(raw)) facts.bodyLines.push(withoutPlaceholders(raw));
  });
  return { source: facts.source, fragments: facts.fragments, body: squashed(facts.bodyLines.join(' ')) };
}
