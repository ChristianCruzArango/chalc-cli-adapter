// source.mjs — lectura estructural del código fuente. Responsabilidad ÚNICA: convertir texto en
// hechos medibles (dónde empieza y acaba cada función, cuántos parámetros tiene, qué tan hondo
// anida). Razón de cambio: la sintaxis de los lenguajes que el portón analiza.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// NO es un parser: es un lector de llaves e indentación sobre el texto ya limpio de comentarios y
// literales. Elegido a propósito — un AST por lenguaje traería dependencias, y el invariante del
// proyecto es cero. A cambio, los umbrales son configurables y el análisis se limita a los archivos
// CAMBIADOS, que es lo que mantiene el ruido bajo. Limitación conocida: no distingue una expresión
// regular de una división, así que un regex con comillas dentro puede confundir al sanitizador.

// Palabras que van seguidas de paréntesis pero no abren una función.
const NOT_FUNCTIONS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'do', 'else', 'return', 'new', 'typeof',
  'await', 'yield', 'super', 'throw', 'using', 'lock', 'foreach', 'when', 'with'
]);

// Firma de función/método: modificadores, tipo de retorno opcional, nombre y paréntesis.
const FUNCTION = /^\s*(?:(?:export|default|public|private|protected|internal|static|async|override|final|abstract|virtual|sealed|suspend|fun|def|external|inline)\s+)*(?:function\s*\*?\s*)?(?:[\w<>[\],.?]+\s+)?([A-Za-z_$][\w$]*)\s*(?:<[^<>()]*>)?\s*\(/;

// Función asignada a una constante: `const total = (a, b) => …`.
const ASSIGNED = /^\s*(?:export\s+)?(?:const|let|var|final|val)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?\(/;

// ── sanitizado ────────────────────────────────────────────────────────────────────────────────

// Reemplaza por espacios el contenido de comentarios y literales, conservando saltos de línea y
// posiciones. Sin esto el linter marcaría el `console.log` de un comentario o contaría las llaves
// de un texto — y un linter con falsos positivos se desactiva a la semana.
// `strings: false` conserva el CONTENIDO de los literales y vacía solo los comentarios. Lo pide la
// etapa de duplicación (spec 012, R2): vaciar las cadenas volvía idénticas las tablas `es` y `en` de
// cualquier marco bilingüe —misma estructura, distinto texto— y las reportaba como copias. Para el
// resto de reglas el defecto sigue siendo vaciarlo todo: ahí lo que importa es no contar las llaves
// de un texto ni el `console.log` de un comentario.
export function blankOut(text, { lineComment = '//', block = true, template = true, strings = true } = {}) {
  const out = text.split('');
  const blank = (i) => { if (out[i] !== '\n') out[i] = ' '; };

  let i = 0;
  while (i < text.length) {
    // comentario de bloque
    if (block && text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2);
      const stop = end < 0 ? text.length : end + 2;
      for (let j = i; j < stop; j++) blank(j);
      i = stop;
      continue;
    }
    // comentario de línea
    if (lineComment && text.startsWith(lineComment, i)) {
      while (i < text.length && text[i] !== '\n') blank(i++);
      continue;
    }
    // literal de texto
    const quote = text[i];
    if (strings && (quote === '"' || quote === "'" || (template && quote === '`'))) {
      blank(i++);
      while (i < text.length) {
        if (text[i] === '\\') { blank(i); blank(i + 1); i += 2; continue; }
        if (text[i] === quote) { blank(i++); break; }
        // Un literal de una línea sin cerrar no puede tragarse el resto del archivo.
        if (text[i] === '\n' && quote !== '`') break;
        blank(i++);
      }
      continue;
    }
    i++;
  }
  return out.join('');
}

// Líneas del texto, sin la línea vacía final que deja el salto de cierre.
export function linesOf(text) {
  const lines = text.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

// ── firmas ────────────────────────────────────────────────────────────────────────────────────

// Firma que abre en la línea `i`, o null. Devuelve el nombre y dónde está su paréntesis.
function headerAt(lines, i) {
  for (const re of [FUNCTION, ASSIGNED]) {
    const m = re.exec(lines[i]);
    if (m && !NOT_FUNCTIONS.has(m[1])) return { name: m[1], paren: m.index + m[0].length - 1 };
  }
  return null;
}

// Número de parámetros de la firma que empieza en `lines[i]` con `(` en `paren`. Recorre las líneas
// que hagan falta: una firma repartida en varias líneas es justo la que suele tener demasiados.
function paramsFrom(lines, i, paren) {
  let depth = 0;
  let text = '';
  for (let row = i; row < lines.length; row++) {
    const from = row === i ? paren : 0;
    for (let col = from; col < lines[row].length; col++) {
      const c = lines[row][col];
      if ('([{<'.includes(c)) depth += 1;
      else if (')]}>'.includes(c)) {
        depth -= 1;
        if (depth === 0) return count(text);
      }
      if (depth >= 1 && !(row === i && col === paren)) text += c;
    }
    text += ' ';
  }
  return count(text);
}

// Cuenta parámetros separando por las comas de primer nivel (las de dentro de genéricos, objetos o
// callbacks no separan nada).
function count(inside) {
  if (!inside.trim()) return 0;
  let depth = 0;
  let params = 1;
  for (const c of inside) {
    if ('([{<'.includes(c)) depth += 1;
    else if (')]}>'.includes(c)) depth -= 1;
    else if (c === ',' && depth === 0) params += 1;
  }
  return params;
}

// ── análisis ──────────────────────────────────────────────────────────────────────────────────

const delta = (line) => [...line].reduce((d, c) => d + (c === '{' ? 1 : c === '}' ? -1 : 0), 0);

// Recorre las líneas SANITIZADAS y devuelve { functions, deepest }.
// - `functions`: { line, name, params, length } de cada función que se abre.
// - `deepest`: la primera línea de cada función donde el anidamiento cruza `maxDepth`.
export function analyze(lines, { maxDepth = 3 } = {}) {
  const functions = [];
  const deepest = [];
  const open = [];        // funciones abiertas, la última es la que anida
  let depth = 0;

  for (let i = 0; i < lines.length; i++) {
    const header = headerAt(lines, i);
    if (header) {
      open.push({ line: i + 1, name: header.name, start: depth, opened: false, deep: false });
      functions.push({ line: i + 1, name: header.name, params: paramsFrom(lines, i, header.paren), length: 0 });
    }

    depth += delta(lines[i]);

    const frame = open[open.length - 1];
    if (frame) {
      if (depth > frame.start) frame.opened = true;
      // Profundidad relativa al cuerpo: la llave de la propia función no cuenta como anidamiento.
      const relative = depth - frame.start - 1;
      if (relative > maxDepth && !frame.deep) {
        frame.deep = true;
        deepest.push({ line: i + 1, depth: relative, name: frame.name });
      }
    }

    // Se cierran las funciones cuyo cuerpo terminó. Una función de una sola expresión
    // (`get x() => y;`) nunca abre llave: se cierra en cuanto la sentencia acaba.
    while (open.length) {
      const last = open[open.length - 1];
      const closedBody = last.opened && depth <= last.start;
      const oneLiner = !last.opened && depth === last.start && lines[i].trimEnd().endsWith(';');
      if (!closedBody && !oneLiner) break;
      open.pop();
      const fn = functions.find((f) => f.line === last.line && f.name === last.name);
      if (fn) fn.length = i + 1 - last.line + 1;
    }
  }

  return { functions, deepest };
}

// Número de línea (1-based) de una posición dentro del texto.
export const lineAt = (text, index) => text.slice(0, index).split('\n').length;
