// O-01 (spec 016, R24) — el historial del agente no crece sin tope dentro del prompt: un `recall` se
// entrega por tramos (como mucho MAX_RECALL_CHARS, con `offset` para seguir) y los pasos del historial
// entran del más reciente hacia atrás mientras caben en el presupuesto (los 2 últimos, siempre).

import test from 'node:test';
import assert from 'node:assert/strict';
import { runAgent, MAX_RECALL_CHARS } from '../cli/engine/loop.mjs';
import { formatHistory, createRenderPrompt } from '../cli/engine/harness.mjs';
import { estimateTokens } from '../cli/engine/budgeter.mjs';

const scripted = (turns) => { let i = 0; return async () => turns[Math.min(i++, turns.length - 1)]; };
const renderPrompt = () => ({ system: 's', user: 'u' });

test('R24: a huge recall is served in chunks with offset/next/total (about 250k tokens became one chunk)', async () => {
  const big = 'A'.repeat(MAX_RECALL_CHARS) + 'B'.repeat(MAX_RECALL_CHARS) + 'C'.repeat(10);
  const tools = { cat: { summary: 'cat', run: async () => ({ body: big }) } };
  const r = await runAgent({
    chatImpl: scripted([
      '{"action":{"tool":"cat","args":{}}}',
      '{"action":{"tool":"recall","args":{"ref":"c1"}}}',
      `{"action":{"tool":"recall","args":{"ref":"c1","offset":${MAX_RECALL_CHARS * 2}}}}`,
      '{"done":true,"summary":"ok"}'
    ]),
    tools, renderPrompt
  });
  const first = r.steps[1].observation;
  assert.equal(first.content, 'A'.repeat(MAX_RECALL_CHARS));
  assert.deepEqual([first.offset, first.next, first.total], [0, MAX_RECALL_CHARS, big.length]);
  const last = r.steps[2].observation;
  assert.equal(last.content, 'C'.repeat(10));
  assert.equal(last.next, undefined);
  assert.ok(MAX_RECALL_CHARS >= 4000 && MAX_RECALL_CHARS <= 20000);
});

test('R24: a small recall is returned whole, exactly as before', async () => {
  const tools = { cat: { summary: 'cat', run: async () => ({ body: 'X'.repeat(2000) }) } };
  const r = await runAgent({
    chatImpl: scripted(['{"action":{"tool":"cat","args":{}}}', '{"action":{"tool":"recall","args":{"ref":"c1"}}}', '{"done":true,"summary":"ok"}']),
    tools, renderPrompt
  });
  assert.deepEqual(r.steps[1].observation, { recall: 'c1', content: 'X'.repeat(2000) });
});

const step = (n, size) => ({ step: n, thought: 't', action: { tool: 'read' }, observation: { body: 'x'.repeat(size) } });

test('R24: history keeps the newest steps within the budget and says how many were omitted', () => {
  const history = Array.from({ length: 10 }, (_, i) => step(i + 1, 4000));
  const txt = formatHistory(history, { budgetTokens: 3000, language: 'en' });
  assert.match(txt, /Step 10/);
  assert.match(txt, /Step 9/);
  assert.doesNotMatch(txt, /Step 1:/);
  assert.match(txt, /8 earlier steps omitted/);
  assert.ok(estimateTokens(txt) < 3000);
});

test('R24: the two most recent steps always stay, even over budget', () => {
  const txt = formatHistory([step(1, 50), step(2, 40000), step(3, 40000)], { budgetTokens: 100, language: 'en' });
  assert.match(txt, /Step 3/);
  assert.match(txt, /Step 2/);
  assert.match(txt, /1 earlier steps omitted/);
});

test('R24: without budget pressure the history text is unchanged (no omission note)', () => {
  const history = [step(1, 10), step(2, 10)];
  assert.equal(formatHistory(history, { budgetTokens: 6000, language: 'en' }), formatHistory(history, { language: 'en' }));
  assert.doesNotMatch(formatHistory(history, { budgetTokens: 6000, language: 'en' }), /omitted/);
});

test('R24: the turn prompt passes its budget to the history', () => {
  const render = createRenderPrompt({ task: 'x', budgetTokens: 2000, language: 'en' });
  const { user } = render({ history: Array.from({ length: 8 }, (_, i) => step(i + 1, 4000)), stepsLeft: 3 });
  assert.match(user, /earlier steps omitted/);
});

// Un recall concreto a través del loop real: cat deja la referencia c1 y recall la expande.
async function recallOf(body, args) {
  const tools = { cat: { summary: 'cat', run: async () => ({ body }) } };
  const r = await runAgent({
    chatImpl: scripted(['{"action":{"tool":"cat","args":{}}}', JSON.stringify({ action: { tool: 'recall', args: { ref: 'c1', ...args } } }), '{"done":true,"summary":"ok"}']),
    tools, renderPrompt
  });
  return r.steps[1].observation;
}

test('R24: recall boundaries — exact size is whole, offset pages small content, negative offset is 0, last chunk has no next', async () => {
  assert.deepEqual(await recallOf('E'.repeat(MAX_RECALL_CHARS), {}), { recall: 'c1', content: 'E'.repeat(MAX_RECALL_CHARS) });
  assert.deepEqual(await recallOf('X'.repeat(1500) + 'Y'.repeat(500), { offset: 1500 }), { recall: 'c1', content: 'Y'.repeat(500), offset: 1500, total: 2000 });
  const negative = await recallOf('Z'.repeat(MAX_RECALL_CHARS + 1), { offset: -5 });
  assert.equal(negative.offset, 0);
  assert.equal(negative.next, MAX_RECALL_CHARS);
  const exactEnd = await recallOf('Q'.repeat(MAX_RECALL_CHARS * 2), { offset: MAX_RECALL_CHARS });
  assert.equal(exactEnd.next, undefined);
  assert.equal(exactEnd.content.length, MAX_RECALL_CHARS);
});

test('R24: history exactly at the budget keeps every step', () => {
  const history = [step(1, 300), step(2, 300), step(3, 300)];
  const exact = history.reduce((n, s) => n + estimateTokens(formatHistory([s], { language: 'en' })), 0);
  assert.doesNotMatch(formatHistory(history, { budgetTokens: exact, language: 'en' }), /omitted/);
  assert.match(formatHistory(history, { budgetTokens: exact - 1, language: 'en' }), /1 earlier steps omitted/);
});
