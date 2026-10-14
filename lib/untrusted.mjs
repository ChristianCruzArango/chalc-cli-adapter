// lib/untrusted.mjs — neutraliza texto no confiable antes de inyectarlo en un prompt XML.
// Responsabilidad única: que un documento (ticket, Word, HU, propuesta) no pueda CERRAR el elemento
// que lo envuelve (`</source_document>`) y colar instrucciones fuera del bloque de datos (S4).
// `</` → `<\/` es idempotente: escapar dos veces no cambia nada.

export function escapeClosingTags(text) {
  return String(text ?? '').replace(/<\//g, '<\\/');
}
