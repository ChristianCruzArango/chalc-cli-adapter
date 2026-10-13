// T7 (spec 017, R5) — leer el evento de un hook sin colgar el turno del asistente.
//
// Lo comparten el anotador (`record.mjs`) y la guarda (`guard.mjs`). El stream se inyecta para poder
// probarlo dentro del proceso; el uso real (process.stdin) lo cubren los tests de subproceso de cada uno.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readStdin } from '../catalog/gate/lib/stdin.mjs';

test('R5: everything that arrives is read, in order', async () => {
  assert.equal(await readStdin(Readable.from(['{"a":', '1}'])), '{"a":1}');
});

test('R5: bytes are decoded as utf-8', async () => {
  assert.equal(await readStdin(Readable.from([Buffer.from('ñandú')], { objectMode: false })), 'ñandú');
});

test('R5: a terminal is not waited on', async () => {
  const terminal = Object.assign(new Readable({ read() {} }), { isTTY: true });
  assert.equal(await readStdin(terminal), '');
});

test('R5: a stream that fails gives an empty event instead of an error', async () => {
  const broken = new Readable({ read() { this.destroy(new Error('boom')); } });
  assert.equal(await readStdin(broken), '');
});

test('R5: an empty stream gives an empty event', async () => {
  assert.equal(await readStdin(Readable.from([])), '');
});

test('R5: a character split between two chunks is decoded whole', async () => {
  const bytes = Buffer.from('ñ');
  assert.equal(await readStdin(Readable.from([bytes.subarray(0, 1), bytes.subarray(1)], { objectMode: false })), 'ñ');
});
