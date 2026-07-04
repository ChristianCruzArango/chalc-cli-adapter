// Evals de robustez: el harness debe sobrevivir a lo que un modelo local (qwen2.5-coder:7b, etc.) realmente
// emite — JSON con cercado ```, prosa alrededor, o un primer intento malformado. Se prueba con el harness
// REAL (createRenderPrompt + runAgent), sin red, con respuestas guionizadas que imitan esos fallos.

import test from 'node:test';
import assert from 'node:assert/strict';
import { runAgent } from '../cli/engine/loop.mjs';
import { createRenderPrompt } from '../cli/engine/harness.mjs';

const renderPrompt = createRenderPrompt({ task: 'toca un archivo', tools: { touch: { summary: 'toca' } }, language: 'es' });

function scripted(turns) {
  let i = 0;
  return async () => turns[Math.min(i++, turns.length - 1)];
}

test('robustez: acepta un turno envuelto en ```json con prosa alrededor', async () => {
  const chatImpl = scripted([
    'Claro, primero leo:\n```json\n{"thought":"leer","action":{"tool":"touch","args":{}}}\n```\nlisto',
    'Ya terminé:\n```\n{"done":true,"summary":"hecho"}\n```'
  ]);
  const r = await runAgent({ chatImpl, tools: { touch: { summary: 'toca', run: async () => ({ ok: true }) } }, renderPrompt });
  assert.equal(r.done, true);
  assert.equal(r.steps.length, 1);
});

test('robustez: se recupera de un primer intento en prosa (sin JSON) y luego cumple', async () => {
  let n = 0;
  const chatImpl = async () => {
    n++;
    if (n === 1) return 'No estoy seguro de qué hacer, déjame pensar...';   // inválido: sin JSON
    return '{"done":true,"summary":"tras corregirme"}';
  };
  const r = await runAgent({ chatImpl, tools: {}, renderPrompt, maxSteps: 2, maxRetries: 2 });
  assert.equal(r.done, true);
  assert.equal(r.summary, 'tras corregirme');
});

test('robustez: tolera comillas y llaves dentro de los strings del JSON', async () => {
  const chatImpl = scripted([
    '{"thought":"el patrón es {a:1}","action":{"tool":"touch","args":{"note":"dice \\"hola\\""}}}',
    '{"done":true,"summary":"ok"}'
  ]);
  const r = await runAgent({ chatImpl, tools: { touch: { summary: 'toca', run: async (a) => ({ got: a.note }) } }, renderPrompt });
  assert.equal(r.done, true);
  assert.equal(r.steps[0].observation.got, 'dice "hola"');
});
