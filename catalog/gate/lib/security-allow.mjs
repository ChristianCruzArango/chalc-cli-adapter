// security-allow.mjs — las supresiones `chalc-allow` (spec 014, R12, R13). Responsabilidad ÚNICA:
// leer qué hallazgos de seguridad se declararon aceptables y con qué motivo. Razón de cambio: la
// sintaxis de la supresión.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// Forma: `chalc-allow: <regla> — <motivo>`, en un comentario de la misma línea o de la anterior. El
// separador puede ser `—`, `--` o `-`, porque no todos los teclados tienen la raya.
//
// El motivo es obligatorio y tiene que explicar algo: al menos tres palabras. «ok» o «es seguro» no
// le dicen nada a quien venga detrás, y una supresión que no se puede revisar es una etapa apagada
// por partes.

const ALLOW = /chalc-allow:\s*([a-z][a-z-]*)\s*(?:(?:—|--|-)\s*(.*?))?\s*(?:\*\/|-->)?\s*$/;
const MIN_WORDS = 3;

const hasReason = (reason) => reason.split(/\s+/).filter((word) => /\p{L}/u.test(word)).length >= MIN_WORDS;

// Las supresiones declaradas en el texto CRUDO —con comentarios, que es donde viven—. Devuelve
// [{ line, rule, reason, valid }]; `valid` es false cuando falta el motivo.
export function allowsIn(text) {
  const found = [];
  String(text ?? '').split(/\r?\n/).forEach((raw, i) => {
    const m = ALLOW.exec(raw);
    if (!m) return;
    const reason = (m[2] || '').trim();
    found.push({ line: i + 1, rule: m[1], reason, valid: hasReason(reason) });
  });
  return found;
}

// La supresión válida que cubre un hallazgo: misma regla, en su línea o en la inmediatamente
// anterior. Más arriba ya no es «esta línea», y alcanzaría a código escrito después.
export const allowFor = (allows, finding) => allows.find((a) => a.valid
  && a.rule === finding.rule
  && (a.line === finding.line || a.line === finding.line - 1));
