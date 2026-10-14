// T12 (spec 020, R12) — tokens y tiempo por tarea.
//
// Claude Code deja en el transcript de cada sesión (y de cada rol) el `usage` de cada mensaje del modelo. Un
// mismo mensaje aparece en VARIAS líneas —una por bloque de contenido— con el mismo `usage`, así que se cuenta
// una sola vez por `message.id`. Lo consumido se carga a la tarea en curso en el momento del evento; el tiempo
// de una tarea va de su primera acción registrada a la última.

import test from 'node:test';
import assert from 'node:assert/strict';
import { addUsage, currentTaskId, emptyStore, MAX_SEEN, taskIdOf, usageOf, ZERO } from '../catalog/live/lib/usage.mjs';

const usage = (input, output, cacheRead = 0, cacheWrite = 0) => ({ input_tokens: input, output_tokens: output, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: cacheWrite });
const line = (id, u, type = 'assistant') => JSON.stringify({ type, message: { id, usage: u } });

test('R12: the usage of each message is summed once, even when it spans several lines', () => {
  const text = [line('m1', usage(2, 10, 100, 50)), line('m1', usage(2, 10, 100, 50)), line('m2', usage(3, 20, 7, 0))].join('\n');
  assert.deepEqual(usageOf(text).tokens, { input: 5, output: 30, cacheRead: 107, cacheWrite: 50 });
});

test('R12: messages already counted in an earlier event are not counted again', () => {
  const first = usageOf(line('m1', usage(1, 1)));
  const second = usageOf([line('m1', usage(1, 1)), line('m2', usage(4, 6))].join('\n'), first.seen);
  assert.deepEqual(second.tokens, { input: 4, output: 6, cacheRead: 0, cacheWrite: 0 });
  assert.deepEqual(second.seen, ['m1', 'm2']);
});

test('R12: only assistant messages with usage count; broken or foreign lines are skipped', () => {
  const text = ['{ roto', '', line('u1', usage(9, 9), 'user'), JSON.stringify({ type: 'assistant', message: { id: 'x' } }), JSON.stringify({ type: 'assistant', message: { usage: usage(1, 1) } }), 'null', line('ok', usage(1, 2))].join('\n');
  assert.deepEqual(usageOf(text).tokens, { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 });
  assert.deepEqual(usageOf('').tokens, ZERO);
});

test('R12: a missing or non-numeric field counts as zero', () => {
  const text = line('m', { input_tokens: 3, output_tokens: 'x' });
  assert.deepEqual(usageOf(text).tokens, { input: 3, output: 0, cacheRead: 0, cacheWrite: 0 });
});

test('R12: the memory of seen messages is capped, keeping the newest', () => {
  const text = Array.from({ length: MAX_SEEN + 3 }, (_, i) => line(`m${i}`, usage(1, 0))).join('\n');
  const { seen, tokens } = usageOf(text);
  assert.equal(tokens.input, MAX_SEEN + 3);
  assert.equal(seen.length, MAX_SEEN);
  assert.equal(seen[0], 'm3');
});

test('R12: the task in progress is the first pending one, named by its id', () => {
  assert.equal(currentTaskId('- [x] **T1** (R1) — Hecha\n- [ ] **T2** (R2) — Esta\n- [ ] **T3** — Luego\n'), 'T2');
  assert.equal(currentTaskId('- [x] **T1** — Hecha\n'), '');
  assert.equal(currentTaskId(''), '');
  assert.equal(currentTaskId(undefined), '');
});

test('R12: a task without an id is named by its text', () => {
  assert.equal(taskIdOf('**T12** (R3) — Algo'), 'T12');
  assert.equal(taskIdOf('Escribir el README'), 'Escribir el README');
  assert.equal(taskIdOf('Usar HTTP2 en el server'), 'Usar HTTP2 en el server');
});

test('R12: usage is added to its task, and the task keeps when it started and when it last moved', () => {
  let store = emptyStore();
  store = addUsage(store, { task: 'T1', tokens: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 }, at: '2026-10-13T10:00:00.000Z' });
  store = addUsage(store, { task: 'T1', tokens: { input: 10, output: 20, cacheRead: 30, cacheWrite: 40 }, at: '2026-10-13T10:05:00.000Z' });
  store = addUsage(store, { task: 'T2', tokens: ZERO, at: '2026-10-13T10:06:00.000Z' });
  assert.deepEqual(store.tasks.T1, { input: 11, output: 22, cacheRead: 33, cacheWrite: 44, firstAt: '2026-10-13T10:00:00.000Z', lastAt: '2026-10-13T10:05:00.000Z' });
  assert.deepEqual(store.tasks.T2, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, firstAt: '2026-10-13T10:06:00.000Z', lastAt: '2026-10-13T10:06:00.000Z' });
});

test('R12: adding never changes the store it was given', () => {
  const store = emptyStore();
  addUsage(store, { task: 'T1', tokens: ZERO, at: '2026-10-13T10:00:00.000Z' });
  assert.deepEqual(store, emptyStore());
  assert.deepEqual(emptyStore(), { cursors: {}, tasks: {} });
});

test('R12: an unreadable store starts empty instead of breaking', () => {
  for (const broken of [null, [], 'x', { tasks: 5 }, { cursors: [] }]) {
    const store = addUsage(broken, { task: 'T1', tokens: ZERO, at: 'a' });
    assert.deepEqual(Object.keys(store.tasks), ['T1'], JSON.stringify(broken));
    assert.deepEqual(store.cursors, {}, JSON.stringify(broken));
  }
});
