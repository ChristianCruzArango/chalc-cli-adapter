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
//
// Con `strings: false` los literales se RECORREN igual, solo que sin vaciarlos: si no se recorrieran,
// el `//` de `"http://…"` se leería como el inicio de un comentario y se llevaría el resto de la
// línea. La etapa de seguridad (spec 014, R10) busca justo esas URLs dentro de los literales.
export function blankOut(text, { lineComment = '//', block = true, template = true, strings = true } = {}) {
  const out = text.split('');
  const blankComment = (i) => { if (out[i] !== '\n') out[i] = ' '; };
  const blankLiteral = strings ? blankComment : () => {};

  let i = 0;
  while (i < text.length) {
    // comentario de bloque
    if (block && text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2);
      const stop = end < 0 ? text.length : end + 2;
      while (i < stop) blankComment(i++);
      continue;
    }
    // comentario de línea
    if (lineComment && text.startsWith(lineComment, i)) {
      while (i < text.length && text[i] !== '\n') blankComment(i++);
      continue;
    }
    // literal de expresión regular (`/^["']/`): sus comillas y llaves no son de verdad. Sin esto, una
    // comilla dentro de la regex abría un «string» que se comía el resto de la línea y descuadraba el
    // largo de las funciones. Solo donde una `/` no puede ser una división.
    if (lineComment === '//' && text[i] === '/' && text[i + 1] !== '/' && text[i + 1] !== '*' && regexMayStart(text, i)) {
      const end = regexEnd(text, i);
      if (end > 0) {
        for (let j = i + 1; j < end; j++) blankLiteral(j);
        i = end + 1;
        continue;
      }
    }
    // literal de texto
    const quote = text[i];
    if (quote === '"' || quote === "'" || (template && quote === '`')) {
      i = stringEnd(text, i, blankLiteral);
      continue;
    }
    i++;
  }
  return out.join('');
}

// Recorre el literal de texto que abre la comilla en `start`, pasando cada posición a `blank`, y
// devuelve dónde sigue el texto. Un literal de una línea sin cerrar no puede tragarse el resto del
// archivo: termina en el salto de línea.
function stringEnd(text, start, blank) {
  const quote = text[start];
  let i = start;
  blank(i++);
  while (i < text.length) {
    if (text[i] === '\\') { blank(i); blank(i + 1); i += 2; continue; }
    if (text[i] === quote) { blank(i++); break; }
    if (text[i] === '\n' && quote !== '`') break;
    blank(i++);
  }
  return i;
}

// ¿Puede empezar aquí una regex? Si lo anterior es un operador, una apertura o una palabra como
// `return`, una `/` no puede ser una división.
const REGEX_AFTER_WORD = /\b(?:return|typeof|case|in|of|delete|void|throw|new|yield|await)$/;
function regexMayStart(text, i) {
  let j = i - 1;
  while (j >= 0 && (text[j] === ' ' || text[j] === '\t')) j--;
  if (j < 0 || text[j] === '\n') return true;
  if ('(,=:[!&|?{};+-*%<>~^'.includes(text[j])) return true;
  return REGEX_AFTER_WORD.test(text.slice(Math.max(0, j - 10), j + 1));
}

// Posición de la `/` que cierra la regex que abre en `i` (sin contar las de una clase `[...]`), o -1
// si la línea acaba antes: entonces no era una regex.
function regexEnd(text, i) {
  let inClass = false;
  for (let j = i + 1; j < text.length && text[j] !== '\n'; j++) {
    const c = text[j];
    if (c === '\\') { j++; continue; }
    if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) return j;
  }
  return -1;
}

// Líneas del texto, sin la línea vacía final que deja el salto de cierre.
export function linesOf(text) {
  const lines = text.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

// ── firmas ────────────────────────────────────────────────────────────────────────────────────

// Firma que abre en la línea `i`, o null. Devuelve el nombre y dónde está su paréntesis.
// `ignore` son nombres que en ESTE archivo no abren una función que revisar.
function headerAt(lines, i, ignore) {
  for (const re of [FUNCTION, ASSIGNED]) {
    const m = re.exec(lines[i]);
    if (m && !NOT_FUNCTIONS.has(m[1]) && !ignore.has(m[1])) return { name: m[1], paren: m.index + m[0].length - 1 };
  }
  return null;
}

// La firma que empieza en `lines[i]` con `(` en `paren`: cuántos parámetros tiene y qué viene justo
// después del paréntesis que la cierra, en esa misma línea. Recorre las líneas que hagan falta: una
// firma repartida en varias líneas es justo la que suele tener demasiados.
function signatureFrom(lines, i, paren) {
  let depth = 0;
  let text = '';
  for (let row = i; row < lines.length; row++) {
    const from = row === i ? paren : 0;
    for (let col = from; col < lines[row].length; col++) {
      const c = lines[row][col];
      if ('([{<'.includes(c)) depth += 1;
      else if (')]}>'.includes(c)) {
        depth -= 1;
        if (depth === 0) return { params: count(text), after: afterClose(lines, row, col) };
      }
      if (depth >= 1 && !(row === i && col === paren)) text += c;
    }
    text += ' ';
  }
  return { params: count(text), after: '' };
}

// Lo que sigue al paréntesis de cierre: el resto de la línea o, si está vacío, la siguiente línea con
// algo. Ahí se ve si la firma abre un cuerpo o era una llamada.
function afterClose(lines, row, col) {
  const rest = lines[row].slice(col + 1).trim();
  if (rest) return rest;
  const next = lines.slice(row + 1).find((line) => line.trim());
  return next ? `\n${next.trim()}` : '';
}

// ¿Lo que sigue a la firma abre un cuerpo de función? En Dart: `{`, `=>`, `async`, `async*`, `sync*`,
// o `:` de una lista de inicializadores en la misma línea. Una llamada sigue con `,`, `;` o `)`, y en
// un árbol de widgets de Flutter TODO son llamadas (`Text(`, `const SizedBox(`, `return Container(`).
const DART_BODY = /^(?:\{|=>|async\b|sync\*|:)|^\n(?:\{|=>|async\b|sync\*)/;

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


// Recorre las líneas SANITIZADAS y devuelve { functions, deepest }.
// - `functions`: { line, name, params, length } de cada función que se abre.
// - `deepest`: la primera línea de cada función donde el anidamiento cruza `maxDepth`.
//
// `requireBody` exige que la firma abra un cuerpo para contarla como función. Lo pide Dart, donde la
// forma `Nombre(` al inicio de línea es casi siempre la llamada a un constructor.
export function analyze(lines, { maxDepth = 3, ignore = [], requireBody = false } = {}) {
  const functions = [];
  const deepest = [];
  const open = [];        // funciones abiertas, la última es la que anida
  let depth = 0;
  const skip = ignore instanceof Set ? ignore : new Set(ignore);

  for (let i = 0; i < lines.length; i++) {
    const header = headerAt(lines, i, skip);
    const signature = header && signatureFrom(lines, i, header.paren);
    if (header && (!requireBody || DART_BODY.test(signature.after))) {
      open.push({ line: i + 1, name: header.name, start: depth, opened: false, deep: false });
      functions.push({ line: i + 1, name: header.name, params: signature.params, length: 0 });
    }

    // Carácter a carácter: una función de UNA línea con llaves (`function f() { return x; }`) abre y
    // cierra en la misma línea, y mirando solo la profundidad al final de la línea nunca constaba como
    // abierta — seguía «abierta» y se le sumaban las líneas siguientes (falso function-too-long).
    const frame = open[open.length - 1];
    for (const c of lines[i]) {
      if (c === '{') { depth += 1; if (frame && depth > frame.start) frame.opened = true; }
      else if (c === '}') depth -= 1;
    }

    if (frame) {
      // Profundidad relativa al cuerpo: la llave de la propia función no cuenta como anidamiento.
      const relative = depth - frame.start - 1;
      if (relative > maxDepth && !frame.deep) {
        frame.deep = true;
        deepest.push({ line: i + 1, depth: relative, name: frame.name });
      }
    }

    closeFinished({ open, functions }, depth, i, lines[i]);
  }

  return { functions, deepest };
}

// Cierra las funciones cuyo cuerpo terminó en la línea `i` y anota su largo. Una función de una sola
// expresión (`get x() => y;`) nunca abre llave: se cierra en cuanto la sentencia acaba.
function closeFinished({ open, functions }, depth, i, line) {
  while (open.length) {
    const last = open[open.length - 1];
    const closedBody = last.opened && depth <= last.start;
    const oneLiner = !last.opened && depth === last.start && line.trimEnd().endsWith(';');
    if (!closedBody && !oneLiner) return;
    open.pop();
    const fn = functions.find((f) => f.line === last.line && f.name === last.name);
    if (fn) fn.length = i + 1 - last.line + 1;
  }
}

// Número de línea (1-based) de una posición dentro del texto.
export const lineAt = (text, index) => text.slice(0, index).split('\n').length;
