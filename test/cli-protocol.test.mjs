import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTurn, validateTurn, readTurn, retryMessage } from '../cli/engine/protocol.mjs';

test('parseTurn extrae el JSON aunque venga con cercado ``` y texto alrededor', () => {
  const raw = 'Claro, aquí va:\n```json\n{"thought":"leer","action":{"tool":"read","args":{"path":"a.js"}}}\n```\nlisto';
  const r = parseTurn(raw);
  assert.equal(r.ok, true);
  assert.equal(r.value.action.tool, 'read');
});

test('parseTurn falla limpio (sin lanzar) ante respuesta no-JSON', () => {
  const r = parseTurn('no tengo idea de qué hacer');
  assert.equal(r.ok, false);
  assert.match(r.error, /JSON/);
});

test('parseTurn rechaza un array de nivel superior', () => {
  const r = parseTurn('[1,2,3]');
  assert.equal(r.ok, false);
});

test('parseTurn sobrevive a prosa con llaves ANTES del JSON válido', () => {
  const r = parseTurn('Voy a usar {write} para crear el archivo:\n{"action":{"tool":"write","args":{"path":"a.md","content":"con } y { dentro"}}}');
  assert.equal(r.ok, true);
  assert.equal(r.value.action.tool, 'write');
  assert.equal(r.value.action.args.content, 'con } y { dentro');   // llaves dentro de strings no rompen el escaneo
});

test('parseTurn maneja comillas escapadas dentro de strings', () => {
  const r = parseTurn('{"thought":"dice \\"hola\\" y {","action":{"tool":"list","args":{}}}');
  assert.equal(r.ok, true);
  assert.equal(r.value.action.tool, 'list');
});

test('validateTurn reconoce el turno final done', () => {
  const r = validateTurn({ done: true, summary: 'edité el archivo' });
  assert.equal(r.ok, true);
  assert.equal(r.turn.kind, 'done');
  assert.equal(r.turn.summary, 'edité el archivo');
});

test('validateTurn normaliza una acción (tool + args + thought)', () => {
  const r = validateTurn({ thought: 'ver', action: { tool: 'grep', args: { q: 'foo' } } });
  assert.equal(r.ok, true);
  assert.equal(r.turn.kind, 'action');
  assert.equal(r.turn.tool, 'grep');
  assert.deepEqual(r.turn.args, { q: 'foo' });
  assert.equal(r.turn.thought, 'ver');
});

test('validateTurn exige action.tool como string no vacío', () => {
  assert.equal(validateTurn({ action: {} }).ok, false);
  assert.equal(validateTurn({ action: { tool: '' } }).ok, false);
  assert.equal(validateTurn({}).ok, false);
});

test('validateTurn tolera args ausente o no-objeto (queda {})', () => {
  const r = validateTurn({ action: { tool: 'list' } });
  assert.equal(r.ok, true);
  assert.deepEqual(r.turn.args, {});
});

test('readTurn combina parseo + validación en un paso', () => {
  const r = readTurn('{"done":true,"summary":"ok"}');
  assert.equal(r.ok, true);
  assert.equal(r.turn.kind, 'done');
});

test('retryMessage antepone el error concreto y recuerda ambos formatos', () => {
  const msg = retryMessage('Falta "action".');
  assert.match(msg, /Falta "action"/);
  assert.match(msg, /"done":true/);
  assert.match(msg, /"action"/);
});
