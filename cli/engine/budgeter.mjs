// cli/engine/budgeter.mjs — presupuesto de tokens para modelos locales (ventana chica).
// Responsabilidad única: estimar tamaño y decidir QUÉ entra en el prompt ANTES de llamar al modelo,
// no medir después. Las secciones requeridas siempre entran; las opcionales, en orden, mientras quepan.
// La compresión del volumen (observaciones, archivos) la hace CCR aguas arriba; aquí se prioriza el texto.

// Heurística barata y provider-agnóstica: ~4 caracteres por token. No necesita el tokenizer real
// (que variaría por modelo); basta una cota para no desbordar la ventana.
export function estimateTokens(text) {
  return Math.ceil(String(text ?? '').length / 4);
}

// Ensambla secciones priorizadas dentro de un presupuesto. Cada sección: { key, text, required? }.
// - Requeridas: entran siempre (son innegociables aunque excedan el presupuesto).
// - Opcionales: entran en orden mientras la suma no supere el presupuesto; las que no caben se reportan.
// Devuelve { text, tokens, included, dropped } preservando el orden original de `sections`.
export function assembleWithinBudget(sections = [], budgetTokens = Infinity) {
  const included = new Set();
  let tokens = 0;

  for (const s of sections) {
    if (s.required) { included.add(s.key); tokens += estimateTokens(s.text); }
  }
  for (const s of sections) {
    if (s.required || included.has(s.key)) continue;
    const cost = estimateTokens(s.text);
    if (tokens + cost <= budgetTokens) { included.add(s.key); tokens += cost; }
  }

  const kept = sections.filter((s) => included.has(s.key));
  return {
    text: kept.map((s) => s.text).join('\n\n'),
    tokens,
    included: kept.map((s) => s.key),
    dropped: sections.filter((s) => !included.has(s.key)).map((s) => s.key)
  };
}
