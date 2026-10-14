// T10 (spec 022, R6 + R19, F-loop) — mutantes de cli/engine/{neartools,loop,harness,reviewfile}.mjs.
// Resolución de tools inexistentes, lista de disponibles acotada, historial y bitácora de revisión.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tempDir } from './helpers/tmpdir.mjs';
import { truncatedMcpNames, uniqueSuffixName, narrowByArgs, nearTools } from '../cli/engine/neartools.mjs';
import { runAgent } from '../cli/engine/loop.mjs';
import { formatHistory } from '../cli/engine/harness.mjs';
import { startReview, logFixOrder, logVerify, reviewPath } from '../cli/engine/reviewfile.mjs';

test('neartools: el mínimo de 4 caracteres incluye el 4', () => {
  assert.deepEqual(truncatedMcpNames(['mcp__srv__x'], 'mcp_'), ['mcp__srv__x']);
  assert.deepEqual(truncatedMcpNames(['mcp__srv__x'], 'mcp'), []);
  assert.deepEqual(uniqueSuffixName(['mcp__s__abcd'], 'abcd'), ['mcp__s__abcd']);
  assert.deepEqual(uniqueSuffixName(['mcp__s__ab'], 'ab'), []);
});

test('neartools: sin args no se desambigua; con args, todas las claves deben encajar', () => {
  const tools = { a: { argHints: ['q'] }, b: {} };
  assert.deepEqual(narrowByArgs(tools, ['a', 'b'], {}), ['a', 'b']);
  assert.deepEqual(narrowByArgs(tools, ['fantasma', 'a'], { q: 1 }), ['a']);
  const two = { a: { argHints: ['q'] }, b: { argHints: ['w'] } };
  assert.deepEqual(narrowByArgs(two, ['a', 'b'], { q: 1, z: 2 }), ['a', 'b']);
});

test('neartools: una resolución única por prefijo no la borra una heurística posterior vacía', () => {
  assert.deepEqual(nearTools({ mcp__srv__tool: {}, read: {} }, { tool: 'mcp__srv' }), ['mcp__srv__tool']);
  assert.deepEqual(nearTools({ mcp__x__y: {}, mcp__s__mcp__x: {} }, { tool: 'mcp__x' }), ['mcp__x__y']);
});

test('loop: la lista "available" de una tool desconocida se acota a 12', async () => {
  const tools = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`t${i}`, { summary: 'x', run: async () => ({}) }]));
  const turns = ['{"action":{"tool":"nope","args":{}}}', '{"done":true,"summary":"ok"}'];
  let i = 0;
  const r = await runAgent({ chatImpl: async () => turns[i++], tools, renderPrompt: () => ({ system: 's', user: 'u' }) });
  assert.equal(r.steps[0].observation.available.length, 12);
  assert.deepEqual(r.steps[0].observation.available, Object.keys(tools).slice(0, 12));
});

test('harness: un paso sin thought no imprime "undefined" ni relleno; con thought, lo muestra', () => {
  const out = formatHistory([{ step: 1, action: { tool: 'read' }, observation: {} }], { language: 'en' });
  assert.match(out, / 1: \n/);
  const withThought = formatHistory([{ step: 1, thought: 'PENSAMIENTO', action: {}, observation: {} }], { language: 'en' });
  assert.match(withThought, / 1: PENSAMIENTO\n/);
});

test('reviewfile: la orden se sangra recortada y una orden vacía no inventa texto', async (t) => {
  const dir = await tempDir(t);
  startReview(dir, 'tarea');
  logFixOrder(dir, '  hola  \n  mundo  ');
  logFixOrder(dir, undefined);
  logVerify(dir, 1, { ok: false, command: 'x', output: '\n  fallo  \n' });
  const text = readFileSync(reviewPath(dir), 'utf8');
  assert.ok(text.includes('### Orden de corrección al junior\n\n    hola  \n      mundo\n'));
  assert.ok(text.includes('### Orden de corrección al junior\n\n    \n'));
  assert.ok(text.includes('\n    fallo\n'));
  assert.ok(!text.includes('Stryker'));
});
