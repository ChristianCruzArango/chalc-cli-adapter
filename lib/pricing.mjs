// lib/pricing.mjs — estimación LOCAL de coste en USD por tokens (specs/002-chalc-tokens, R5-R7, R10).
// Responsabilidad única: convertir { modelo, tokens } en dólares con una tabla honesta y editable.
// Sin red: los precios cambian, así que son una ESTIMACIÓN y el usuario puede pisarlos en su
// ~/.chalc/config.json con `prices: { "<modelo>": { input: USD/1M, output: USD/1M } }`.
// Lo desconocido devuelve null — jamás se inventa un coste (el reporte lo marca "sin precio").

// USD por 1 MILLÓN de tokens (entrada / salida). Solo modelos comunes y verificables; las claves
// van normalizadas (minúsculas, sin vendor, puntos como guiones) y se emparejan por PREFIJO, así
// una versión con sufijo de fecha (claude-sonnet-4-6-20250929) hereda el precio de su base.
export const MODEL_PRICES = {
  // Anthropic
  'claude-opus-4': { input: 15, output: 75 },
  'claude-sonnet-4': { input: 3, output: 15 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-3-5-haiku': { input: 0.8, output: 4 },
  // OpenAI
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4-1': { input: 2, output: 8 },
  'gpt-4-1-mini': { input: 0.4, output: 1.6 },
  'o3-mini': { input: 1.1, output: 4.4 },
  // Google
  'gemini-2-0-flash': { input: 0.1, output: 0.4 },
  'gemini-2-5-flash': { input: 0.3, output: 2.5 },
  'gemini-2-5-pro': { input: 1.25, output: 10 },
  // Abiertos frecuentes en OpenRouter
  'deepseek-chat': { input: 0.27, output: 1.1 },
  'llama-3-1-70b': { input: 0.3, output: 0.4 }
};

// Proveedores que corren en la máquina del usuario: coste real $0 (R10), no "sin precio".
const FREE_PROVIDERS = new Set(['ollama']);

// Canónica para emparejar: minúsculas, sin el prefijo de vendor de OpenRouter (anthropic/…) y
// con puntos como guiones (claude-sonnet-4.6 ≡ claude-sonnet-4-6).
export function normalizeModelId(model) {
  const s = String(model || '').trim().toLowerCase();
  const sinVendor = s.includes('/') ? s.slice(s.lastIndexOf('/') + 1) : s;
  return sinVendor.replaceAll('.', '-');
}

// Busca el precio de un modelo: exacto primero, después la clave-prefijo MÁS LARGA (para que
// claude-sonnet-4-6 gane a claude-sonnet-4 cuando ambas encajan).
function priceFor(modelId, table) {
  if (table[modelId]) return table[modelId];
  const prefix = Object.keys(table)
    .filter((k) => modelId.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  return prefix ? table[prefix] : null;
}

// Estima el coste en USD de un consumo. userPrices (config del usuario) pisa la tabla (R7).
// Devuelve un número (0 incluido) o null si el modelo no tiene precio conocido (R6).
export function estimateCostUSD({ provider, model, input = 0, output = 0 } = {}, userPrices = {}) {
  if (FREE_PROVIDERS.has(String(provider || '').toLowerCase())) return 0;
  const id = normalizeModelId(model);
  if (!id) return null;
  const userTable = Object.fromEntries(
    Object.entries(userPrices || {}).map(([k, v]) => [normalizeModelId(k), v])
  );
  const price = priceFor(id, userTable) || priceFor(id, MODEL_PRICES);
  if (!price || typeof price.input !== 'number' || typeof price.output !== 'number') return null;
  return (input * price.input + output * price.output) / 1e6;
}
