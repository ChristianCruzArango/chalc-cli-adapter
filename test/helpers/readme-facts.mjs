// test/helpers/readme-facts.mjs — la estructura de un README que no depende del idioma (spec 017, R13).
// Responsabilidad ÚNICA: sacar de un markdown lo que dos traducciones deben compartir, y decir en qué
// se separan dos de ellas. Puro: recibe texto, devuelve hechos.
//
// Lo que se compara es lo que NO es idioma: niveles de encabezado, forma de cada tabla, bloques de
// código con su etiqueta y las opciones de línea de comandos de cada bloque. Rutas de ejemplo,
// descripciones entre comillas y etiquetas de diagramas cambian con el idioma, así que no se miran.

const FENCE = /^```(\S*)/;
const HEADING = /^(#{1,6})\s/;
const TABLE_ROW = /^\s*\|/;
// Una opción (`-x`, `--xyz`) que no forma parte de otra palabra (`mi-app`, `x--y`).
const OPTION = /(?<![\w-])--?[a-zA-Z][\w-]*/g;
// Un comentario de shell: desde `#` al principio o tras un espacio. Se traduce, así que no cuenta.
const COMMENT = /(^|\s)#.*$/;

const optionsOf = (lines) => lines.flatMap((line) => line.replace(COMMENT, '').match(OPTION) || []);
// Una celda con `\|` (p. ej. `es\|en`) sigue siendo UNA celda: solo separa la barra sin escapar.
const cellsOf = (row) => row.trim().replace(/^\||(?<!\\)\|$/g, '').split(/(?<!\\)\|/).length;

/** Hechos estructurales de un markdown: { headings, tables (celdas por fila), blocks, selector }. */
export function readmeFacts(markdown) {
  const facts = { headings: [], tables: [], blocks: [], selector: '' };
  let block = null;
  let table = null;

  for (const line of String(markdown ?? '').split(/\r?\n/)) {
    const fence = FENCE.exec(line);
    if (fence) {
      if (block) { facts.blocks.push({ lang: block.lang, options: optionsOf(block.lines) }); block = null; }
      else block = { lang: fence[1], lines: [] };
      table = null;
      continue;
    }
    if (block) { block.lines.push(line); continue; }

    const heading = HEADING.exec(line);
    if (heading) facts.headings.push(heading[1].length);
    if (!facts.selector && facts.headings.length && line.startsWith('>')) facts.selector = line.trim();

    if (!TABLE_ROW.test(line)) { table = null; continue; }
    // La forma de una tabla es la cuenta de celdas de cada fila: así una fila de más o una columna de
    // más en cualquier fila (no solo en la cabecera) se separa de su traducción.
    if (!table) { table = []; facts.tables.push(table); }
    table.push(cellsOf(line));
  }
  return facts;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// La primera posición en la que dos listas se separan, o -1.
function firstMismatch(a, b) {
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) if (!same(a[i], b[i])) return i;
  return -1;
}

/** La primera diferencia estructural entre dos README, o '' si coinciden. El número es 1-based. */
export function firstDifference(a, b) {
  const checks = [
    ['heading', a.headings, b.headings],
    ['table', a.tables, b.tables],
    ['block', a.blocks.map((x) => x.lang), b.blocks.map((x) => x.lang)],
    ['option', a.blocks.map((x) => x.options), b.blocks.map((x) => x.options)]
  ];
  for (const [what, left, right] of checks) {
    const at = firstMismatch(left, right);
    if (at >= 0) return `${what} #${at + 1}: ${JSON.stringify(left[at])} vs ${JSON.stringify(right[at])}`;
  }
  return '';
}
