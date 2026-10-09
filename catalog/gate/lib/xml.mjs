// xml.mjs — lectura mínima de los reportes XML de mutación (junit de mutmut, mutations.xml de PIT).
// Responsabilidad ÚNICA: sacar elementos, atributos y texto de un XML plano. Razón de cambio: la
// forma en que se leen esos reportes.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// No es un parser de XML de propósito general y no pretende serlo: cero dependencias es invariante
// del proyecto, y estos dos reportes son XML generado por máquina, plano y sin elementos del mismo
// nombre anidados. Cualquier otro uso queda fuera de contrato.

const ATTR = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

// Lo que va entre el nombre de una etiqueta y su cierre, respetando las comillas: un `>` dentro de
// un atributo (`name="a>b"`) no cierra la etiqueta (G-06). Antes se cortaba ahí y el mutante perdía
// archivo y línea —y si era un superviviente, se descartaba y el score subía—.
const TAG_BODY = `(\\s(?:[^>"']|"[^"]*"|'[^']*')*?)?`;

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

// Entidades XML en UNA sola pasada: predefinidas, decimales (`&#38;`, que PIT usa en descripciones)
// y hexadecimales (`&#x3C;`). Dos pasadas decodificaban dos veces: `&#38;lt;` acababa en `<`.
// Las predefinidas distinguen mayúsculas (`&LT;` no es una entidad XML y se deja literal).
const ENTITY = /&(?:#[xX]([0-9a-fA-F]+)|#(\d+)|(lt|gt|amp|quot|apos));/g;
const decode = (s) => s.replace(ENTITY, (_, hex, dec, named) =>
  (named ? ENTITIES[named] : String.fromCodePoint(hex ? parseInt(hex, 16) : Number(dec))));

// Texto de un elemento: los bloques CDATA van tal cual (dentro no hay entidades) y el resto se decodifica.
const CDATA = /(<!\[CDATA\[[\s\S]*?\]\]>)/;
const decodeText = (s) => s.split(CDATA)
  .map((part) => (part.startsWith('<![CDATA[') ? part.slice(9, -3) : decode(part)))
  .join('');

// Atributos de una etiqueta, a partir del texto crudo que va entre el nombre y el cierre.
export function attrsOf(raw = '') {
  const attrs = {};
  for (const m of raw.matchAll(ATTR)) attrs[m[1]] = decode(m[2] ?? m[3] ?? '');
  return attrs;
}

// Elementos `<name …>` del documento, en orden. Devuelve { attrs, inner }; `inner` es null cuando la
// etiqueta viene auto-cerrada (`<testcase … />`, que es como ElementTree escribe un mutante cazado).
// El nombre se ancla con `\s`, `/` o `>` para que `<mutation>` no cace también a `<mutations>`.
export function elements(text, name) {
  const re = new RegExp(`<${name}${TAG_BODY}(?:/>|>([\\s\\S]*?)</${name}\\s*>)`, 'g');
  const found = [];
  for (const m of text.matchAll(re)) found.push({ attrs: attrsOf(m[1] || ''), inner: m[2] ?? null });
  return found;
}

// Texto del primer hijo `<name>` dentro de un elemento. '' si no está.
export function childText(inner, name) {
  const m = new RegExp(`<${name}${TAG_BODY}>([\\s\\S]*?)</${name}\\s*>`).exec(inner || '');
  return m ? decodeText(m[2]).trim() : '';
}
