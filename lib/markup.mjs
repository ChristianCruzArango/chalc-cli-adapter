// lib/markup.mjs — recorridos LINEALES de XML/HTML y de espacios, para texto que no es de confianza.
// Responsabilidad ÚNICA: partir marcado en etiquetas, bloques y texto sin expresiones que retrocedan.
//
// Las formas habituales —`<x\b[^>]*>([\s\S]*?)<\/x>`, `<[^>]+>`, `[ \t]+$`, `\t+\n`— son
// cuadráticas cuando falta el cierre: cada intento recorre hasta el final del texto, falla y vuelve
// a empezar en el carácter siguiente. Con 320 KB fabricados eso eran de segundos a casi un minuto de
// event loop bloqueado. Aquí se busca con `indexOf`, y en cuanto un cierre no aparece se sabe que
// tampoco aparecerá para ningún inicio posterior: el recorrido termina.

const NAME_CHAR = /[\w:.-]/;

// Mismo texto en minúsculas ASCII, con la MISMA longitud (toLowerCase puede alargar algunos
// caracteres Unicode y descuadrar los índices).
const asciiLower = (text) => text.replace(/[A-Z]+/g, (s) => s.toLowerCase());

/** Etiquetas y texto en orden: `{ tag }` (lo que hay entre `<` y `>`) o `{ text }`. */
export function* tokens(source) {
  let i = 0;
  while (i < source.length) {
    const lt = source.indexOf('<', i);
    const gt = lt < 0 ? -1 : source.indexOf('>', lt + 1);
    if (gt < 0) { yield { text: source.slice(i) }; return; }   // un `<` sin `>` ya es texto hasta el final
    if (lt > i) yield { text: source.slice(i, lt) };
    if (gt === lt + 1) yield { text: '<>' };
    else yield { tag: source.slice(lt + 1, gt) };
    i = gt + 1;
  }
}

/**
 * Elementos `<tag …>cuerpo</tag>` (o `<tag …/>`) en orden: `{ attrs, body }`. Equivale a
 * `<tag\b([^>]*)>([\s\S]*?)<\/tag>`, salvo que un `<tag/>` autocerrado no se traga al siguiente.
 */
export function* elements(source, tag) {
  const open = `<${tag}`;
  const close = `</${tag}>`;
  let i = 0;
  for (;;) {
    const start = source.indexOf(open, i);
    if (start < 0) return;
    const after = start + open.length;
    if (NAME_CHAR.test(source[after] || '')) { i = after; continue; }   // `<tc` no es `<t`
    const gt = source.indexOf('>', after);
    if (gt < 0) return;
    const attrs = source.slice(after, gt);
    if (attrs.endsWith('/')) { yield { attrs: attrs.slice(0, -1), body: '' }; i = gt + 1; continue; }
    const end = source.indexOf(close, gt + 1);
    if (end < 0) return;
    yield { attrs, body: source.slice(gt + 1, end) };
    i = end + close.length;
  }
}

/** Atributos de cada etiqueta de apertura `<tag …>` o `<tag …/>`, tenga o no cierre. */
export function* startTags(source, tag) {
  const open = `<${tag}`;
  let i = 0;
  for (;;) {
    const start = source.indexOf(open, i);
    if (start < 0) return;
    const after = start + open.length;
    i = after;
    if (NAME_CHAR.test(source[after] || '')) continue;
    const gt = source.indexOf('>', after);
    if (gt < 0) return;
    const attrs = source.slice(after, gt);
    yield attrs.endsWith('/') ? attrs.slice(0, -1) : attrs;
    i = gt + 1;
  }
}

/**
 * Sustituye cada bloque que abre con `open` y cierra con `close` (`<!--`…`-->`, `<script`…`</script>`).
 * `boundary`: lo que sigue a `open` no puede continuar un nombre (`<scripts` no es `<script`).
 * Un bloque sin cierre se deja tal cual, como hacía la expresión equivalente.
 */
export function replaceBlocks(source, open, close, { ignoreCase = false, boundary = false, replacement = '' } = {}) {
  const hay = ignoreCase ? asciiLower(source) : source;
  const [o, c] = ignoreCase ? [open.toLowerCase(), close.toLowerCase()] : [open, close];
  const out = [];
  let i = 0;
  let from = 0;
  for (;;) {
    const start = hay.indexOf(o, from);
    if (start < 0) break;
    if (boundary && NAME_CHAR.test(hay[start + o.length] || '')) { from = start + o.length; continue; }
    const end = hay.indexOf(c, start + o.length);
    if (end < 0) break;
    out.push(source.slice(i, start), replacement);
    i = from = end + c.length;
  }
  out.push(source.slice(i));
  return out.join('');
}

/** Quita las corridas de `run` que van justo antes de `next` (`\t+\n` → `\n` con run='\t'). */
export function dropRunBefore(text, run, next) {
  const out = [];
  let i = 0;
  for (;;) {
    const start = text.indexOf(run, i);
    if (start < 0) break;
    let end = start;
    while (text[end] === run) end++;
    out.push(text.slice(i, start));
    if (text[end] !== next) out.push(text.slice(start, end));
    i = end;
  }
  out.push(text.slice(i));
  return out.join('');
}

/** Cada línea sin espacios ni tabuladores al final. */
export function trimLineEnds(text) {
  return text.split('\n').map((line) => {
    let end = line.length;
    while (end && (line[end - 1] === ' ' || line[end - 1] === '\t')) end--;
    return line.slice(0, end);
  }).join('\n');
}
