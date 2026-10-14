// T2 (spec 022, R17, S9 CCR) — el almacén CCR tiene un tope de BYTES totales (no solo de entradas)
// y, al pasarlo, evicta primero las más viejas (FIFO).

import test from 'node:test';
import assert from 'node:assert/strict';
import { createCcrStore } from '../lib/ccr.mjs';

const refOf = (placeholder) => placeholder.match(/ref=(\w+)/)[1];

test('T2 (spec 022, R17, S9 CCR): total bytes over the cap evict the oldest entries first', () => {
  const store = createCcrStore({ threshold: 1, maxBytes: 20 });
  const a = refOf(store.compact('ñ'.repeat(4)));    // 8 bytes
  const b = refOf(store.compact('ü'.repeat(4)));    // 8 bytes → 16
  assert.ok(store.has(a) && store.has(b));
  const c = refOf(store.compact('é'.repeat(4)));    // 8 bytes → 24 > 20: sale `a`
  assert.equal(store.has(a), false);
  assert.ok(store.has(b) && store.has(c));
  assert.equal(store.stats().bytes, 16);
});

test('T2 (spec 022, R17, S9 CCR): bytes are measured in UTF-8, not characters', () => {
  const store = createCcrStore({ threshold: 1, maxBytes: 10 });
  const a = refOf(store.compact('ñ'.repeat(3)));    // 3 chars, 6 bytes
  refOf(store.compact('ü'.repeat(3)));              // 12 bytes en total > 10
  assert.equal(store.has(a), false);
});

test('T2 (spec 022, R17, S9 CCR): a single entry bigger than the cap is kept (newest) and recallable', () => {
  const store = createCcrStore({ threshold: 1, maxBytes: 4 });
  const big = 'x'.repeat(10);
  const ref = refOf(store.compact(big));
  assert.equal(store.recall(ref), big);
  assert.equal(store.stats().entries, 1);
});

test('T2 (spec 022, R17, S9 CCR): TTL eviction keeps the byte accounting right', () => {
  const store = createCcrStore({ threshold: 1, ttlMs: 10, now: () => clock });
  let clock = 0;
  const ref = refOf(store.compact('hola mundo'));
  assert.equal(store.stats().bytes, 10);
  clock = 100;
  assert.equal(store.recall(ref), null);
  assert.equal(store.stats().bytes, 0);
});
