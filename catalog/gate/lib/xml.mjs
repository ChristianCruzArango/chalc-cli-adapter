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

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

// Entidades XML predefinidas. `&#38;` y demás numéricas también, que PIT las usa en descripciones.
const decode = (s) => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/&(lt|gt|amp|quot|apos);/g, (_, e) => ENTITIES[e]);

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
  const re = new RegExp(`<${name}(\\s[^>]*?)?(?:/>|>([\\s\\S]*?)</${name}\\s*>)`, 'g');
  const found = [];
  for (const m of text.matchAll(re)) found.push({ attrs: attrsOf(m[1] || ''), inner: m[2] ?? null });
  return found;
}

// Texto del primer hijo `<name>` dentro de un elemento. '' si no está.
export function childText(inner, name) {
  const m = new RegExp(`<${name}(?:\\s[^>]*?)?>([\\s\\S]*?)</${name}\\s*>`).exec(inner || '');
  return m ? decode(m[1]).trim() : '';
}
