// duplication.mjs — bloques de código repetidos (spec 012). Responsabilidad ÚNICA: decir qué texto
// está duplicado y dónde. Razón de cambio: qué se considera duplicación.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// La spec 007 dejó la duplicación fuera de alcance porque el linter se limita a «señales medibles y
// de alta confianza». Comparar texto normalizado sí cae de ese lado: no hace falta entender el código
// para decir que estas doce líneas están idénticas en otro archivo. Lo que sigue fuera es la
// duplicación SEMÁNTICA —dos funciones que hacen lo mismo con otros nombres—, que es del revisor:
// normalizar identificadores para cazarla dispararía tanto que el linter se acabaría apagando, y un
// linter apagado no protege nada.
//
// Puro: recibe textos, devuelve posiciones. Quien lee el árbol es `sources.mjs`.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { blankOut } from './source.mjs';
import { sourceFiles } from './sources.mjs';
import { touchesChange } from './hunks.mjs';
import { RULES } from './rules.mjs';

// Líneas que se repiten por la GRAMÁTICA del lenguaje y no por copia. En TypeScript, cinco imports
// seguidos de un `}` aparecen idénticos en medio repo: contarlas produciría cientos de hallazgos
// falsos el primer día y nadie volvería a leer el informe.
const GRAMMAR_NOISE = [
  /^(?:import|export)\b[^=]*$/,        // import … / export * from … (no `export const x = …`)
  // Las mismas cabeceras en los otros stacks. Los specs hermanos de un mismo servicio comparten
  // media docena de ellas palabra por palabra, y no hay forma de "deduplicarlas": las obliga el
  // lenguaje. `using (var x = …)` NO entra aquí — eso es un bloque con cuerpo, y ahí sí puede
  // haber copia.
  /^(?:global\s+)?using\s+(?:static\s+)?[\w.]+\s*;?$/,   // C#
  /^from\s+[\w.]+\s+import\b[^=]*$/,                     // Python
  /^package\b[^=]*$/,                                    // Java / Kotlin / Dart
  /^[)\]}>;,\s]+$/,                    // cierres sueltos: } ) ]; });
  /^(?:else|try|do|finally)\s*\{?$/,
  /^@\w+\([^)]*\)$/,                   // un decorador solo en su línea
  /^['"]use strict['"];?$/,
  /^(?:public|private|protected|static)?\s*\{$/
];

const isNoise = (code) => GRAMMAR_NOISE.some((re) => re.test(code));

// Las líneas que cuentan, con su número ORIGINAL: el hallazgo tiene que apuntar al archivo real, no
// a una numeración inventada tras quitar comentarios.
export function significantLines(text) {
  const clean = blankOut(String(text ?? ''), { lineComment: '//', block: true, template: true, strings: false });

  return clean.split(/\r?\n/)
    .map((line, i) => ({ line: i + 1, code: line.replace(/\s+/g, ' ').trim() }))
    .filter(({ code }) => code && !isNoise(code));
}

// Clave de una ventana de `size` líneas a partir de `i`.
const windowKey = (lines, i, size) => lines.slice(i, i + size).map((l) => l.code).join('\n');

// Índice de ventanas: clave → todas las posiciones donde aparece.
function indexWindows(entries, size) {
  const index = new Map();
  for (const { file, lines } of entries) {
    for (let i = 0; i + size <= lines.length; i += 1) {
      const key = windowKey(lines, i, size);
      if (!index.has(key)) index.set(key, []);
      index.get(key).push({ file, at: i, line: lines[i].line });
    }
  }
  return index;
}

// ¿La ocurrencia `b` continúa exactamente donde acababa `a`? Sirve para fundir ventanas solapadas.
const continues = (prev, next) => prev.file === next.file && next.at === prev.at + 1;

// Duplicados: bloques de al menos `minLines` líneas significativas que aparecen más de una vez.
//
// Las ventanas solapadas se FUNDEN (R4): un bloque repetido de 20 líneas con mínimo 6 genera 15
// ventanas, y reportar las quince sería inservible. Se recorre en orden y se extiende mientras las
// dos puntas avancen a la vez.
export function findDuplication(files, { minLines = 6 } = {}) {
  const size = Math.max(1, minLines);
  const entries = files.map(({ file, text }) => ({ file, lines: significantLines(text) }));
  const index = indexWindows(entries, size);

  const found = [];
  const claimed = new Set();   // pares ya cubiertos por un bloque más largo

  for (const spots of index.values()) {
    if (spots.length < 2) continue;

    for (let i = 0; i < spots.length - 1; i += 1) {
      const a = spots[i];
      const b = spots[i + 1];
      if (a.file === b.file && b.at < a.at + size) continue;   // solape consigo mismo, no es copia

      // Si el par anterior ya venía avanzando, este bloque es su continuación: no es un hallazgo
      // nuevo, es el mismo más largo.
      const previous = found.find((d) => continues(d.tail.a, a) && continues(d.tail.b, b));
      if (previous) {
        previous.lines += 1;
        previous.tail = { a, b };
        continue;
      }

      const key = `${a.file}:${a.at}|${b.file}:${b.at}`;
      if (claimed.has(key)) continue;
      claimed.add(key);
      found.push({ a: { file: a.file, line: a.line }, b: { file: b.file, line: b.line }, lines: size, tail: { a, b } });
    }
  }

  return found.map(({ a, b, lines }) => ({ a, b, lines }));
}

// ── la etapa ──────────────────────────────────────────────────────────────────────────────────

// Duplicación que la tarea acaba de introducir. Devuelve hallazgos en el formato del portón.
//
// Se compara contra TODO el árbol (R14), no solo contra lo cambiado: la copia que más duele no es la
// que haces dentro de una misma tarea —esa la ves— sino la del bloque que ya existía en un archivo
// que no abriste.
//
// Pero solo se REPORTA si una de las dos puntas está en algo que tocaste (R5). Es la misma regla que
// rige el resto del linter: un repo con historia tiene duplicación vieja a montones, y volcarla
// entera enterraría el trabajo de hoy.
export async function lintDuplication(root, changed, config = {}, changedLines = null) {
  const { enabled = true, minLines = 6, maxFiles = 4000 } = config;
  if (!enabled) return [];

  const { files, capped } = await sourceFiles(root, { max: maxFiles });
  if (!files.length) return [];

  const texts = [];
  for (const file of files) {
    try { texts.push({ file, text: await readFile(join(root, file), 'utf8') }); } catch { /* ilegible */ }
  }

  const touched = new Set(changed.map((f) => f.replace(/\\/g, '/')));
  const findings = [];

  for (const { a, b, lines } of findDuplication(texts, { minLines })) {
    // El hallazgo apunta al archivo que tocaste; el otro va como dato.
    const mine = touched.has(a.file) ? a : touched.has(b.file) ? b : null;
    if (!mine) continue;

    // Y que el archivo sea tuyo no basta: el bloque puede llevar años ahí y la tarea haber añadido
    // dos líneas al final. Se reporta solo si escribiste DENTRO del bloque repetido.
    if (!touchesChange(changedLines, mine.file, mine.line, mine.line + lines - 1)) continue;

    const other = mine === a ? b : a;

    findings.push({
      file: mine.file,
      line: mine.line,
      rule: RULES.duplication,
      data: { other: other.file, otherLine: other.line, lines, capped }
    });
  }
  return findings;
}
