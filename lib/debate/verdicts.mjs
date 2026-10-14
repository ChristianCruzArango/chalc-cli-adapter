// lib/debate/verdicts.mjs — cómo se lee el VEREDICTO de una ratificación y de un dictamen.
// Responsabilidad ÚNICA: convertir la sección VEREDICTO en un valor cerrado. Razón de cambio: el
// formato que se le pide al modelo en `sections.mjs`.
//
// Se lee la PRIMERA línea (o una etiqueta explícita como `GANA: 1`), nunca la primera palabra que
// aparezca: con `/conforme/` un "No conforme" ratificaba el informe, y con `/\b[12]\b/` un "la 1 y
// la 2 están parejas" inventaba un ganador. Lo que no encaja es ilegible, y lo ilegible no decide.

// Primera línea con contenido, sin comillas, negritas ni puntuación final, y sin la etiqueta.
function firstLine(text, labels) {
  const line = String(text).split('\n')   // sin texto: 'undefined'/'null' no son veredicto → ''
    .map((l) => l.trim()).find(Boolean) || '';
  return line.toLowerCase()
    .replace(/^[\s"'*`«“]+|[\s"'*`»”.!]+$/g, '')
    .replace(new RegExp(`^(?:${labels})\\s*:\\s*`), '')
    .replace(/^[\s"'*`«“]+|[\s"'*`»”.!]+$/g, '');
}

// 'conforme' | 'correcciones' | ''. Una negación de conformidad es pedir correcciones, no ratificar.
export function ratifyVerdict(text) {
  const line = firstLine(text, 'veredicto|verdict');
  if (line === 'conforme') return 'conforme';
  if (/correc/.test(line) || /\b(?:no|not|non)\s+conforme\b/.test(line)) return 'correcciones';
  return '';
}

// '1' | '2' | 'empate' | ''. Solo la primera línea o la etiqueta explícita (`GANA: 1`, `WINNER: 2`).
export function judgeVerdict(text) {
  const line = firstLine(text, 'gana|ganador|winner|veredicto|verdict');
  if (/^(?:empate|tie|tied|draw)$/.test(line)) return 'empate';
  const m = line.match(/^(?:(?:posici[oó]n|position|postura)\s*)?([12])$/);
  return m ? m[1] : '';
}
