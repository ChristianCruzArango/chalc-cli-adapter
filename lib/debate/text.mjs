// lib/debate/text.mjs — cuándo dos textos del modelo dicen lo mismo (spec 014, R17).
// Responsabilidad ÚNICA: comparar texto libre. Razón de cambio: qué se considera "lo mismo".
//
// Lo usan las preguntas (para no preguntar dos veces) y los desacuerdos (para que repetir la misma
// objeción cada ronda no la convierta en tres). Es la MISMA decisión en los dos sitios, así que vive
// en un solo lugar: dos criterios de equivalencia que se separen darían una lista deduplicada y otra
// no, sin que nadie lo note hasta ver el informe.

/** Sin tildes, sin signos, sin mayúsculas y sin espacios de más. */
export function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Palabras que no distinguen nada: aparecen en cualquier frase y, contadas, hacen que dos textos sin
// relación parezcan el mismo. Lista corta a propósito — no es un analizador de lenguaje.
const STOPWORDS = new Set([
  'para', 'como', 'pero', 'porque', 'cuando', 'donde', 'sobre', 'entre', 'desde', 'hasta', 'esta',
  'este', 'esto', 'esos', 'esas', 'unos', 'unas', 'todo', 'toda', 'todos', 'todas', 'puede', 'pueden',
  'debe', 'deben', 'hace', 'hacen', 'tiene', 'tienen', 'sigue', 'siguen', 'está', 'estan', 'estar',
  'muy', 'mas', 'sin', 'con', 'por', 'que', 'los', 'las', 'del', 'una', 'uno', 'the', 'and', 'for'
]);

// Las palabras que de verdad hablan del tema: largas y no vacías.
function significant(text) {
  return new Set(normalizeText(text).split(' ').filter((w) => w.length >= 4 && !STOPWORDS.has(w)));
}

// Cuánto se solapan dos conjuntos respecto al más pequeño. Se mide contra el menor y no contra la
// unión porque una objeción reescrita suele venir más larga: castigar ese detalle extra la haría
// pasar por nueva.
const MIN_OVERLAP = 0.6;
const MIN_WORDS = 4;   // con menos, cualquier coincidencia es casualidad

/**
 * ¿Es el mismo texto? Igualdad tras normalizar, que uno contenga al otro, o que compartan la mayoría
 * de sus palabras con peso.
 *
 * El solape existe porque un modelo NUNCA repite una objeción con las mismas palabras dos rondas
 * seguidas: la reescribe. Comparar solo por subcadena atrapa la copia literal, que es justo el caso
 * que no ocurre — y así la misma objeción acababa contada tres veces en el informe.
 *
 * No entiende paráfrasis de verdad, y el límite es deliberado: adivinar semántica costaría una
 * llamada por comparación. El peor caso sigue siendo un ítem parecido de más, nunca uno perdido.
 */
export function sameText(a, b) {
  const x = normalizeText(a);
  const y = normalizeText(b);
  if (!x || !y) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;

  const sa = significant(x);
  const sb = significant(y);
  const smaller = Math.min(sa.size, sb.size);
  if (smaller < MIN_WORDS) return false;

  let shared = 0;
  for (const w of sa) if (sb.has(w)) shared += 1;
  return shared / smaller >= MIN_OVERLAP;
}
