// complexity.mjs — cuántos caminos tiene una función (spec 031, R6). Responsabilidad ÚNICA: contarlos. Razón de
// cambio: qué cuenta como una decisión.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// Una función corta también puede estar enredada: el largo no lo dice. Es la complejidad ciclomática de
// siempre, contada sobre líneas YA limpias de textos y comentarios: uno, más una por cada decisión.

// `if`, bucles, `case`, `catch`, los operadores lógicos y el ternario. No cuentan `?.` (encadenamiento
// opcional), `?:` (parámetro opcional de TS) ni un `|` suelto (tipo unión).
const DECISION = /\b(?:if|for|while|case|catch)\b|&&|\|\||\?\?|\?(?![.?:])/g;

/** La complejidad de una función dada como líneas de código limpio. */
export const complexityOf = (lines) => 1 + lines.reduce((total, line) => total + (line.match(DECISION) || []).length, 0);
