// test/pricing.test.mjs — estimación de coste en USD (R5, R6, R7, R10 de specs/002-chalc-tokens):
// precio conocido calcula, desconocido devuelve null (jamás se inventa), la config del usuario
// pisa la tabla y los proveedores locales (Ollama) cuestan $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_PRICES, normalizeModelId, estimateCostUSD } from '../lib/pricing.mjs';

// Coste esperado según la propia tabla: los tests fijan la FÓRMULA (USD por 1M de cada lado),
// no los precios concretos — la tabla se actualiza sin romper tests.
const expected = (key, input, output) => (input * MODEL_PRICES[key].input + output * MODEL_PRICES[key].output) / 1e6;

test('normalizeModelId: minúsculas, sin prefijo de vendor y con puntos como guiones', () => {
  assert.equal(normalizeModelId('anthropic/claude-sonnet-4.6'), 'claude-sonnet-4-6');
  assert.equal(normalizeModelId('GPT-4o'), 'gpt-4o');
  assert.equal(normalizeModelId('openai/gpt-4.1-mini'), 'gpt-4-1-mini');
  assert.equal(normalizeModelId(''), '');
  assert.equal(normalizeModelId(null), '');
});

test('R5: un modelo con precio conocido estima USD sumando entrada y salida', () => {
  assert.ok(MODEL_PRICES['claude-sonnet-4-6'], 'la tabla debe traer el default de Anthropic');
  const cost = estimateCostUSD({ provider: 'anthropic', model: 'claude-sonnet-4-6', input: 1_000_000, output: 200_000 });
  assert.equal(cost, expected('claude-sonnet-4-6', 1_000_000, 200_000));
  assert.ok(cost > 0);
});

test('R5: el id de OpenRouter (vendor/modelo con puntos) empareja con la tabla, y las versiones con sufijo hacen prefix-match', () => {
  const base = estimateCostUSD({ provider: 'anthropic', model: 'claude-sonnet-4-6', input: 1000, output: 1000 });
  assert.equal(estimateCostUSD({ provider: 'openrouter', model: 'anthropic/claude-sonnet-4.6', input: 1000, output: 1000 }), base);
  assert.equal(estimateCostUSD({ provider: 'anthropic', model: 'claude-sonnet-4-6-20250929', input: 1000, output: 1000 }), base);
});

test('R6: modelo sin precio conocido → null (nunca inventar un coste)', () => {
  assert.equal(estimateCostUSD({ provider: 'openrouter', model: 'vendor-x/modelo-inventado', input: 1000, output: 1000 }), null);
  assert.equal(estimateCostUSD({ provider: 'openai', model: '', input: 1000, output: 1000 }), null);
});

test('R7: los precios del usuario (config `prices`) pisan la tabla y añaden modelos nuevos', () => {
  const prices = {
    'mi-modelo-privado': { input: 1, output: 2 },
    'claude-sonnet-4.6': { input: 100, output: 100 }   // el usuario puede escribirlo con puntos: se normaliza
  };
  // modelo que la tabla no conoce, pero el usuario sí
  assert.equal(estimateCostUSD({ provider: 'openrouter', model: 'mi-modelo-privado', input: 1_000_000, output: 500_000 }, prices), 2);
  // modelo que la tabla SÍ conoce: gana el precio del usuario
  assert.equal(estimateCostUSD({ provider: 'anthropic', model: 'claude-sonnet-4-6', input: 1_000_000, output: 0 }, prices), 100);
});

test('R10: proveedor local (Ollama) → $0 aunque el modelo no esté en ninguna tabla', () => {
  assert.equal(estimateCostUSD({ provider: 'ollama', model: 'llama3.1', input: 9_999_999, output: 9_999_999 }), 0);
});
