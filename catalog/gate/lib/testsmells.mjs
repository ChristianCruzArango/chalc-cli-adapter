// testsmells.mjs — tests que no prueban nada (spec 030, R9). Responsabilidad ÚNICA: señalar, en los archivos de
// test que cambió la tarea, los que están saltados, enfocados, con una aserción trivial o sin ninguna. Razón de
// cambio: qué cuenta como un test de adorno.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// Son patrones por línea y por bloque, no un parser: afirman solo lo que se ve. «Sin aserción» se busca
// únicamente en JS y TS, donde un caso es una llamada `it(…)`/`test(…)` que se puede delimitar; en otro
// lenguaje no se afirma lo que no se sabe leer.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { RULES } from './rules.mjs';
import { isTestFile } from './sources.mjs';

const JS_FILE = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i;
const COMMENT_LINE = /^\s*(?:\/\/|#|\*)/;

// Lo que se ve en UNA línea, en cualquiera de los lenguajes que el portón conoce.
const LINE_RULES = [
  { rule: RULES.testSkipped, re: /\b(?:it|test|describe)\.skip\s*\(|\bx(?:it|describe|test)\s*\(|@pytest\.mark\.skip|@unittest\.skip|\[(?:Fact|Theory)\s*\(\s*Skip\b|\[Ignore\b|@Disabled\b|@Ignore\b/ },
  { rule: RULES.testFocused, re: /\b(?:it|test|describe)\.only\s*\(|\bf(?:it|describe)\s*\(/ },
  { rule: RULES.testTrivialAssert, re: /\bexpect\(\s*(true|false|null|\d+)\s*\)\.(?:toBe|toEqual|toStrictEqual)\(\s*\1\s*\)|\bexpect\(\s*true\s*\)\.toBeTruthy\(\s*\)|\bassert(?:\.ok)?\(\s*true\s*\)|\bassert\.(?:equal|strictEqual|deepEqual)\(\s*(\d+|true)\s*,\s*\2\s*\)|^\s*assert\s+True\s*$|\bassertTrue\(\s*[Tt]rue\s*\)|\bAssert\.True\(\s*true\s*\)/ }
];

// Dónde empieza un caso de test en JS/TS. `regex.test(x)` y `obj.it(x)` no lo son.
const CASE_START = /(?<![.\w])(?:it|test)(?:\.only|\.skip)?\s*\(/g;
// Algo que afirma: una aserción directa o un ayudante con nombre de comprobación.
const ASSERTS = /\b(?:expect|assert|should|verify|check|must)\w*\s*[.(]|\.should\b|\.rejects\b|\.throws\b/i;

const finding = (file, line, rule) => ({ file, line, rule, data: {} });
const lineAt = (text, index) => text.slice(0, index).split('\n').length;

function skipString(text, start) {
  const quote = text[start];
  let i = start + 1;
  while (i < text.length && text[i] !== quote) i += text[i] === '\\' ? 2 : 1;
  return i;
}

// El final de un comentario que empieza en `start`, o `start` si ahí no hay comentario.
function skipComment(text, start) {
  const end = text[start + 1] === '/' ? text.indexOf('\n', start) : text[start + 1] === '*' ? text.indexOf('*/', start + 2) : start;
  return end < 0 ? text.length : end;
}

// El índice del `)` que cierra el `(` de `open`, sin contar lo que va dentro de textos o comentarios.
function closingParen(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === '`') i = skipString(text, i);
    else if (ch === '/') i = skipComment(text, i);
    else if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return i;
  }
  return text.length;
}

// Los casos de test de un archivo JS/TS que no afirman nada: [{ from, to }] en líneas.
function emptyCases(text) {
  return [...text.matchAll(CASE_START)].map((match) => {
    const open = match.index + match[0].length - 1;
    const close = closingParen(text, open);
    return { from: lineAt(text, match.index), to: lineAt(text, close), body: text.slice(open, close) };
  }).filter((block) => !ASSERTS.test(block.body));
}

/** Los hallazgos de un archivo de test. Con `changedLines` (líneas que escribió la tarea), solo los que las tocan. */
export function lintTestSource(source, { file, changedLines = null }) {
  const text = String(source).replace(/\r\n/g, '\n');
  const touched = changedLines ? new Set(changedLines) : null;
  const touches = (from, to = from) => !touched || [...touched].some((line) => line >= from && line <= to);
  const found = [];
  text.split('\n').forEach((line, index) => {
    if (COMMENT_LINE.test(line) || !touches(index + 1)) return;
    for (const { rule, re } of LINE_RULES) if (re.test(line)) found.push(finding(file, index + 1, rule));
  });
  if (JS_FILE.test(file)) {
    for (const block of emptyCases(text)) if (touches(block.from, block.to)) found.push(finding(file, block.from, RULES.testNoAssert));
  }
  return found.sort((a, b) => a.line - b.line);
}

/** Los hallazgos de los archivos de test de `files` (rutas relativas a `root`). `lines`: Map archivo → líneas de la tarea. */
export async function lintTests(files, { root, lines = null }) {
  const found = [];
  for (const file of files.filter(isTestFile)) {
    let text;
    try { text = await readFile(join(root, ...file.split('/')), 'utf8'); } catch { continue; }   // borrado en la tarea
    const changed = lines?.get?.(file);
    found.push(...lintTestSource(text, { file, changedLines: changed?.size ? [...changed] : null }));
  }
  return found;
}
