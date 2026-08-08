// smells.mjs — reglas de calidad medibles sobre los archivos cambiados (R6). Responsabilidad ÚNICA:
// decir QUÉ es un hallazgo y en qué línea. Razón de cambio: las reglas de la constitución.
// El CÓMO se lee el código vive en `source.mjs`.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// Aquí solo entra lo que se puede señalar con archivo y línea. Lo opinable — ¿es correcta esta
// abstracción?, ¿este nombre dice lo que hace? — es trabajo del agente revisor: si el portón opinara,
// volvería a ser un juicio que nadie puede verificar, que es exactamente lo que la spec vino a quitar.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { analyze, blankOut, lineAt, linesOf } from './source.mjs';
import { RULES } from './rules.mjs';

// Clases que, por convención, coordinan en vez de modelar: un tipo declarado dentro de una de ellas
// es un tipo que nadie va a volver a encontrar.
const SERVICE_CLASS = /\b(?:class)\s+\w*(?:Service|Component|Controller|Repository|Provider|Facade|Store|Handler|Bloc|Cubit)\b/;
const SERVICE_DECORATOR = /^\s*@(?:Component|Injectable|Directive|Pipe|Service|RestController)\b/m;
const SERVICE_FILE = /\.(?:service|component|controller|repository|store)\.[jt]sx?$/;

const C_LIKE = { lineComment: '//', block: true, template: true };

// Cada dialecto declara lo que SÍ sabe reconocer. Lo que no está, no se inventa: una regla que
// dispara mal en un lenguaje se desactiva entera y el linter deja de servir.
const TS = {
  lex: C_LIKE,
  structural: true,
  publicType: /^\s*export\s+(?:default\s+)?(?:abstract\s+)?(?:class|interface|type|enum)\s+(\w+)/,
  typeDecl: /^\s*(?:export\s+)?(?:interface|type)\s+(\w+)/,
  anyType: /(?::\s*any\b|\bas\s+any\b|<\s*any\s*[,>]|\bany\s*\[\])/,
  debug: /\bconsole\.(?:log|debug|dir|trace)\s*\(/
};

const JS = { ...TS, publicType: /^\s*export\s+(?:default\s+)?(?:abstract\s+)?class\s+(\w+)/, typeDecl: null, anyType: null };

const DART = {
  lex: C_LIKE,
  structural: true,
  // Sin `_`: en Dart lo privado empieza por guion bajo, y el State de un StatefulWidget —que el
  // lenguaje OBLIGA a poner en una segunda clase— siempre lo es.
  publicType: /^\s*(?:abstract\s+|sealed\s+|final\s+|base\s+)*(?:class|mixin|enum|extension|typedef)\s+([A-Za-z]\w*)/,
  typeDecl: null,
  anyType: /(?::\s*dynamic\b|\bas\s+dynamic\b)/,
  debug: /(?:^|[^.\w])print\s*\(/
};

const CS = {
  lex: C_LIKE,
  structural: true,
  publicType: /^\s*public\s+(?:sealed\s+|abstract\s+|static\s+|partial\s+|readonly\s+)*(?:class|interface|record|enum|struct)\s+(\w+)/,
  typeDecl: /^\s*(?:public\s+|internal\s+|private\s+)?(?:partial\s+)?(?:interface|record)\s+(\w+)/,
  anyType: /(?:^|[^.\w])dynamic\s+\w/,
  debug: /\bConsole\.Write(?:Line)?\s*\(/
};

const JAVA = {
  lex: C_LIKE,
  structural: true,
  publicType: /^\s*public\s+(?:final\s+|abstract\s+|sealed\s+|static\s+)*(?:class|interface|record|enum)\s+(\w+)/,
  typeDecl: /^\s*(?:public\s+)?(?:interface|record)\s+(\w+)/,
  anyType: null,
  debug: /\bSystem\.(?:out|err)\.print(?:ln)?\s*\(/
};

const KT = {
  lex: C_LIKE,
  structural: true,
  // En Kotlin lo público es el default: se reconoce por AUSENCIA de private/internal.
  publicType: /^\s*(?!.*\b(?:private|internal)\b)(?:open\s+|abstract\s+|sealed\s+|data\s+|value\s+)*(?:class|interface|object)\s+(\w+)/,
  typeDecl: /^\s*(?:interface)\s+(\w+)/,
  anyType: null,
  debug: /(?:^|[^.\w])println\s*\(/
};

// Python va sin análisis estructural: sus bloques son indentación, no llaves, y un contador de
// llaves daría hallazgos falsos. Se le aplican las reglas que sí son ciertas sin leer estructura.
const PY = {
  lex: { lineComment: '#', block: false, template: false },
  structural: false,
  publicType: /^class\s+([A-Za-z]\w*)/,
  typeDecl: null,
  anyType: /(?::\s*Any\b|->\s*Any\b)/,
  debug: null
};

const DIALECTS = {
  '.ts': TS, '.tsx': TS, '.mts': TS, '.cts': TS,
  '.js': JS, '.jsx': JS, '.mjs': JS, '.cjs': JS,
  '.dart': DART, '.cs': CS, '.java': JAVA, '.kt': KT, '.py': PY
};

const dialectFor = (file) => DIALECTS[(file.match(/\.[^./\\]+$/) || [''])[0].toLowerCase()] || null;

// Un hallazgo es archivo, línea, regla y datos. La frase la arma el marco bilingüe (`i18n.mjs`).
const finding = (file, line, rule, data = {}) => ({ file, line, rule, data });

// ── reglas ────────────────────────────────────────────────────────────────────────────────────

// Una cosa por archivo: la primera declaración pública manda, las demás sobran.
function onePerFile(file, lines, dialect) {
  const declared = [];
  lines.forEach((line, i) => {
    const m = dialect.publicType.exec(line);
    if (m) declared.push({ name: m[1], line: i + 1 });
  });
  return declared.slice(1).map((d, i) => finding(
    file, d.line, RULES.onePerFile, { name: d.name, first: declared[0].name, position: i + 2 }
  ));
}

// Tipos declarados dentro de un servicio o componente, exportados o no.
function typeInService(file, text, lines, dialect) {
  if (!dialect.typeDecl) return [];
  const isService = SERVICE_CLASS.test(text) || SERVICE_DECORATOR.test(text) || SERVICE_FILE.test(file);
  if (!isService) return [];

  const found = [];
  lines.forEach((line, i) => {
    const m = dialect.typeDecl.exec(line);
    if (m) found.push(finding(file, i + 1, RULES.typeInService, { name: m[1] }));
  });
  return found;
}

// Smells de tamaño y forma. Solo donde el análisis estructural es fiable.
function measurable(file, text, lines, dialect, limits) {
  const found = [];

  if (lines.length > limits.maxFileLines) {
    found.push(finding(file, 1, RULES.fileTooLong, { lines: lines.length, limit: limits.maxFileLines }));
  }

  if (dialect.structural) {
    const { functions, deepest } = analyze(lines, { maxDepth: limits.maxDepth });

    for (const fn of functions) {
      if (fn.length > limits.maxFunctionLines) {
        found.push(finding(file, fn.line, RULES.functionTooLong, { name: fn.name, lines: fn.length, limit: limits.maxFunctionLines }));
      }
      if (fn.params > limits.maxParams) {
        found.push(finding(file, fn.line, RULES.tooManyParams, { name: fn.name, params: fn.params, limit: limits.maxParams }));
      }
    }

    for (const d of deepest) {
      found.push(finding(file, d.line, RULES.deepNesting, { name: d.name, depth: d.depth, limit: limits.maxDepth }));
    }

    // Un catch vacío no es "manejar el error": es esconderlo, y es el bug que más tarda en aparecer.
    for (const m of text.matchAll(/\bcatch\s*(?:\([^)]*\))?\s*\{\s*\}/g)) {
      found.push(finding(file, lineAt(text, m.index), RULES.emptyCatch));
    }
  }

  lines.forEach((line, i) => {
    if (dialect.debug && dialect.debug.test(line)) found.push(finding(file, i + 1, RULES.debugOutput));
    if (dialect.anyType && dialect.anyType.test(line)) found.push(finding(file, i + 1, RULES.anyType));
  });

  return found;
}

// ── entradas ──────────────────────────────────────────────────────────────────────────────────

// Analiza un archivo ya leído. `file` es la ruta que se reporta y de la que sale el dialecto.
// Devuelve los hallazgos ordenados por línea. Un archivo de un lenguaje que no se sabe leer devuelve
// vacío: mejor no decir nada que decir algo falso.
export function lintSource(text, { file, limits }) {
  const dialect = dialectFor(file);
  if (!dialect) return [];

  const clean = blankOut(text, dialect.lex);
  const lines = linesOf(clean);

  return [
    ...onePerFile(file, lines, dialect),
    ...typeInService(file, clean, lines, dialect),
    ...measurable(file, clean, lines, dialect, limits)
  ].sort((a, b) => a.line - b.line);
}

// Analiza los archivos cambiados de la tarea. Rutas relativas a `root`. Un archivo borrado o
// ilegible se salta: viene en el diff, pero ya no hay nada que revisar y no puede tumbar la corrida.
export async function lintChanged(files, { root, limits }) {
  const found = [];
  for (const file of files) {
    if (!dialectFor(file)) continue;
    let text;
    try { text = await readFile(join(root, file), 'utf8'); } catch { continue; }
    found.push(...lintSource(text, { file, limits }));
  }
  return found;
}
