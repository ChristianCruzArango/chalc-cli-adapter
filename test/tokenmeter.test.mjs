import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUsage, recordUsage, tokenSummary, resetTokens } from '../lib/tokenmeter.mjs';

test('normalizeUsage reads OpenAI-compatible and Anthropic usage shapes', () => {
  assert.deepEqual(normalizeUsage({ prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 }), { input: 100, output: 40, total: 140 });
  assert.deepEqual(normalizeUsage({ input_tokens: 80, output_tokens: 20 }), { input: 80, output: 20, total: 100 });   // total derivado
  assert.deepEqual(normalizeUsage(undefined), { input: 0, output: 0, total: 0 });   // sin usage
});

test('recordUsage accumulates across calls and resetTokens clears it', () => {
  resetTokens();
  recordUsage({ prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 });
  recordUsage({ input_tokens: 10, output_tokens: 5 });
  assert.deepEqual(tokenSummary(), { input: 110, output: 45, total: 155, calls: 2 });
  resetTokens();
  assert.deepEqual(tokenSummary(), { input: 0, output: 0, total: 0, calls: 0 });
});
