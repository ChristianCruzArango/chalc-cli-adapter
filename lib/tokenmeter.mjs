// lib/tokenmeter.mjs — medidor de consumo de tokens de IA. Responsabilidad única: acumular el `usage` que
// devuelve cada llamada (sin importar el proveedor) y exponer el total, para que el CLI lo muestre siempre
// que se consulte la IA. Un proceso = un comando, por eso basta un acumulador de módulo.

let totals = { input: 0, output: 0, total: 0, calls: 0 };

// Normaliza el `usage` de cualquier proveedor a { input, output, total }:
// OpenAI-compatible → prompt_tokens/completion_tokens/total_tokens; Anthropic → input_tokens/output_tokens.
export function normalizeUsage(usage = {}) {
  const input = usage.prompt_tokens ?? usage.input_tokens ?? 0;
  const output = usage.completion_tokens ?? usage.output_tokens ?? 0;
  const total = usage.total_tokens ?? input + output;
  return { input, output, total };
}

// Registra el consumo de una llamada. Devuelve lo normalizado de esa llamada.
export function recordUsage(usage) {
  const u = normalizeUsage(usage);
  totals = { input: totals.input + u.input, output: totals.output + u.output, total: totals.total + u.total, calls: totals.calls + 1 };
  return u;
}

// Total acumulado en este comando.
export function tokenSummary() {
  return { ...totals };
}

// Reinicia el acumulador (útil para tests; en el CLI cada proceso arranca limpio).
export function resetTokens() {
  totals = { input: 0, output: 0, total: 0, calls: 0 };
}
