// lib/toolrules.mjs — las reglas con las que la tabla de herramientas expresa su variación
// (spec 011, R4). Responsabilidad ÚNICA: resolver una regla contra los hechos de un repo.
// Razón de cambio: qué formas de variación admite la tabla.
//
// Por qué un juego CERRADO de reglas y no condicionales libres en JSON: un JSON con expresiones
// arbitrarias es código sin tipos, sin depurador y sin tests — se lee peor que el código que
// pretende sustituir. Cuatro reglas nombradas cubren los siete stacks de hoy. La quinta será una
// decisión consciente, con su test, y no el efecto colateral de añadir un lenguaje.
//
// Ninguna regla sabe de ningún stack: eso es justamente lo que permite que añadir un lenguaje sea
// añadir un archivo de datos (R3).
//
// Puro: recibe los hechos ya leídos. Quien toca disco es `tooltable.mjs`.

// Sin resolver es `null`, no `''` ni `{}`: quien llama decide qué significa la ausencia — un comando
// de tests vacío y un bloque de mutación ausente se tratan distinto.
const UNRESOLVED = null;

// Baja por una ruta con puntos. Un tramo que no es objeto corta: `x.y` sobre `{x: 'texto'}` no es un
// campo vacío, es una config con otra forma, y adivinar ahí sería inventar.
function fieldAt(root, path) {
  let node = root;
  for (const key of String(path).split('.')) {
    if (!node || typeof node !== 'object') return undefined;
    node = node[key];
  }
  return node;
}

const RULES = {
  // Siempre lo mismo. La mayoría de los stacks son esto.
  fixed: (rule) => (rule.value === undefined ? UNRESOLVED : rule.value),

  // Un campo de un JSON del repo decide si el valor aplica. `reject` descarta valores que existen
  // pero no sirven — el `test` que deja `npm init` es el caso que motivó la regla.
  jsonField: (rule, input) => {
    const found = fieldAt(input.json[rule.file], rule.path);
    if (found === undefined || found === null || String(found).trim() === '') return UNRESOLVED;
    // `reject` solo tiene sentido sobre texto; un campo numérico o booleano presente ya es señal.
    if (rule.reject && new RegExp(rule.reject, 'i').test(String(found))) return UNRESOLVED;
    return rule.value;
  },

  // Busca en un texto declarado por el stack (uno o varios archivos concatenados). Gana el PRIMER
  // caso que coincide: el orden de la tabla es la prioridad, no la especificidad.
  bySignal: (rule, input) => {
    const text = input.signals[rule.signal] || '';
    const hit = (rule.cases || []).find((c) => new RegExp(c.match).test(text));
    if (hit) return hit.value;
    return rule.default === undefined ? UNRESOLVED : rule.default;
  },

  // Elige una variante por dependencias o por archivos de configuración, y compone la plantilla con
  // sus datos. Exige EXACTAMENTE una coincidencia: cero es "no hay", varias es ambigüedad, y las dos
  // se tratan igual — como "no sé". Elegir una a dedo sería el falso positivo que la spec 007
  // prohíbe en R2.
  byLookup: (rule, input) => {
    const matches = (rule.variants || []).filter((v) =>
      (v.deps || []).some((d) => input.deps[d]) ||
      (v.files && input.entries.some((e) => new RegExp(v.files).test(e))));
    if (matches.length !== 1) return UNRESOLVED;

    const variant = matches[0];
    const composed = {};
    for (const [key, template] of Object.entries(rule.template || {})) {
      composed[key] = String(template).replace(/\{(\w+)\}/g, (_, field) => variant[field] ?? '');
    }
    return { ...rule.base, ...composed };
  }
};

// Resuelve `rule` contra los hechos de un repo. Devuelve el valor o `null`.
//
// Una regla desconocida devuelve `null` en vez de lanzar: un archivo de la tabla con una errata
// tiene que dejar el campo pendiente —visible y corregible— y no tumbar el equipamiento entero de
// un repo por un dato que el usuario no escribió.
export function resolve(rule, input) {
  const apply = rule && RULES[rule.rule];
  return apply ? apply(rule, input) : UNRESOLVED;
}

// Los nombres de regla que existen. Lo usa el test de forma de la tabla para rechazar erratas.
export const RULE_NAMES = Object.keys(RULES);
