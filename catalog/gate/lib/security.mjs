// security.mjs — señales de seguridad medibles sobre los archivos de la tarea (spec 014).
// Responsabilidad ÚNICA: decir qué hallazgos de seguridad tiene la tarea. Razón de cambio: cómo se
// lee cada lenguaje y qué hallazgos cuentan (supresiones y líneas de la tarea). Las comprobaciones
// viven en `security-checks.mjs`; la sintaxis de las supresiones, en `security-allow.mjs`.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// Aquí solo entra lo que se puede afirmar con archivo y línea sin entender el programa: un secreto
// escrito a mano, un TLS apagado, una URL sin cifrar. Lo que pide entender —si esta ruta exige
// permiso, si este dato es sensible, si esta entrada llega de fuera— es del rol `seguridad`. Si el
// portón opinara sobre eso, dispararía tanto que se acabaría silenciando, y una etapa silenciada no
// protege nada.
//
// Se mira el texto SIN comentarios pero CON el contenido de los literales (R10): ahí viven los
// secretos y las URLs. Es la misma lectura que usa la etapa de duplicación.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { blankOut, linesOf } from './source.mjs';
import { touchesChange } from './hunks.mjs';
import { CHECKS, extOf } from './security-checks.mjs';
import { allowFor, allowsIn } from './security-allow.mjs';
import { RULES } from './rules.mjs';

const C_LIKE = { lex: { lineComment: '//', block: true, template: false, strings: false } };
const JS_LIKE = { lex: { ...C_LIKE.lex, template: true } };
const PYTHON = { lex: { lineComment: '#', block: false, template: false, strings: false } };

// Cada dialecto dice cómo se leen sus comentarios. Un lenguaje sin dialecto no se revisa (R15):
// mejor no decir nada que decir algo falso.
const DIALECTS = {
  '.ts': JS_LIKE, '.tsx': JS_LIKE, '.mts': JS_LIKE, '.cts': JS_LIKE,
  '.js': JS_LIKE, '.jsx': JS_LIKE, '.mjs': JS_LIKE, '.cjs': JS_LIKE,
  '.dart': C_LIKE, '.cs': C_LIKE, '.java': C_LIKE, '.kt': C_LIKE,
  '.py': PYTHON
};

const dialectFor = (file) => DIALECTS[extOf(file)] || null;

// Las líneas tal como las mira la etapa: sin comentarios, con literales. `null` si el lenguaje no
// tiene dialecto, que no es lo mismo que un archivo vacío.
export function securityLines(text, file) {
  const dialect = dialectFor(file);
  if (!dialect) return null;
  return linesOf(blankOut(String(text ?? ''), dialect.lex));
}

const finding = (file, line, rule, data) => ({ file, line, until: line, rule, data });

// Lo que las comprobaciones encuentran, antes de aplicar supresiones.
function detected(lines, file) {
  const found = [];
  lines.forEach((line, i) => {
    for (const check of CHECKS) {
      const match = check.find(line, file);
      if (match) found.push(finding(file, i + 1, check.rule, { match }));
    }
  });
  return found;
}

// Los hallazgos de un archivo ya leído y las supresiones que se aplicaron (R12). Devuelve
// { findings, allowed }: lo suprimido no desaparece, pasa a `allowed` para que la evidencia lo
// muestre. Un `chalc-allow` sin motivo no suprime nada y es un hallazgo más (R13).
export function scanFile(text, { file }) {
  const lines = securityLines(text, file);
  if (!lines) return { findings: [], allowed: [] };

  const allows = allowsIn(text);
  const findings = allows.filter((a) => !a.valid)
    .map((a) => finding(file, a.line, RULES.allowWithoutReason, { rule: a.rule }));
  const allowed = [];

  for (const found of detected(lines, file)) {
    const allow = allowFor(allows, found);
    if (allow) allowed.push({ file, line: found.line, rule: found.rule, reason: allow.reason });
    else findings.push(found);
  }
  return { findings: findings.sort((a, b) => a.line - b.line), allowed };
}

// Solo los hallazgos que cuentan, para quien no necesita las supresiones.
export const scanSource = (text, options) => scanFile(text, options).findings;

// La etapa: los hallazgos y supresiones de los archivos de la tarea, solo en las líneas que la tarea
// escribió (R9). Es la misma atribución que usa la duplicación, y por la misma razón: la deuda que
// ya estaba no es un hallazgo de hoy. Sin líneas anotadas para un archivo se revisa entero.
//
// Un archivo borrado o ilegible se salta: viene en el diff, pero ya no hay nada que revisar.
export async function lintSecurity(files, { root, lines = null }) {
  const findings = [];
  const allowed = [];

  for (const file of files) {
    let text;
    try { text = await readFile(join(root, file), 'utf8'); } catch { continue; }

    const scanned = scanFile(text, { file });
    findings.push(...scanned.findings.filter((f) => touchesChange(lines, file, f.line)));
    allowed.push(...scanned.allowed.filter((a) => touchesChange(lines, file, a.line)));
  }
  return { findings, allowed };
}
