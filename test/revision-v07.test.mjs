// V-07 (spec 016, R8) — en la TUI, un texto pegado nunca responde a una aprobación (una línea `a`
// dentro de lo pegado aprobaba todo el turno), y un ESC partido entre chunks (habitual por SSH) no
// interrumpe el turno: se espera ~50 ms antes de decidir que es un ESC aislado.

import test from 'node:test';
import assert from 'node:assert/strict';
import { handleData, ESC_WAIT_MS } from '../cli/ui/screenkeys.mjs';
import { tuiInput } from '../cli/shell/frontends.mjs';

// Estado mínimo de la caja (sin franja visible: no se dibuja nada en la terminal).
function keyboard() {
  const sent = [];
  const events = { esc: 0 };
  const st = {
    buf: '', cur: 0, hist: [], histIdx: -1, chooser: null, commands: [], scrollOff: 0, uiVisible: false,
    onLine: (line, meta = {}) => sent.push({ line, pasted: !!meta.pasted }),
    onEsc: () => { events.esc++; }, onExit: () => {}
  };
  return { st, sent, events, type: (chunk) => handleData(st, chunk) };
}

test('R8: a bracketed paste is inserted as one line and is not sent by itself', () => {
  const k = keyboard();
  k.type('\x1b[200~uno\r\na\r\ndos\x1b[201~');
  assert.deepEqual(k.sent, []);
  assert.equal(k.st.buf, 'uno a dos');
  k.type('\r');
  assert.deepEqual(k.sent, [{ line: 'uno a dos', pasted: true }]);
});

test('R8: paste markers split across chunks still form one block; typed text afterwards is not pasted', () => {
  const k = keyboard();
  k.type('\x1b[200~a');
  k.type('\r\nb\x1b[2');
  k.type('01~');
  assert.equal(k.st.buf, 'a b');
  k.type('\r');
  k.type('y');
  k.type('\r');
  assert.deepEqual(k.sent, [{ line: 'a b', pasted: true }, { line: 'y', pasted: false }]);
});

test('R8: control characters inside a paste are dropped and the text goes at the cursor', () => {
  const k = keyboard();
  k.type('xy');
  k.type('\x1b[D');
  k.type('\x1b[200~A\x07\tB\x1b[201~');
  assert.equal(k.st.buf, 'xABy');
});

test('R8: text after the end marker in the same chunk is processed as normal keys', () => {
  const k = keyboard();
  k.type('\x1b[200~p\x1b[201~q\r');
  assert.deepEqual(k.sent, [{ line: 'pq', pasted: true }]);
});

test('R8: without bracketed paste, a chunk with several lines marks every line as pasted', () => {
  const k = keyboard();
  k.type('tarea uno\na\nn\r');
  assert.deepEqual(k.sent.map((s) => s.pasted), [true, true, true]);
  k.type('a\r');
  assert.deepEqual(k.sent.at(-1), { line: 'a', pasted: false });
  k.type('s\r\n');
  assert.deepEqual(k.sent.at(-1), { line: 's', pasted: false });
});

test('R8: a lone ESC waits; if the rest of the sequence arrives, it is a key, not an interrupt', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const k = keyboard();
  k.type('ab');
  k.type('\x1b');
  assert.equal(k.events.esc, 0);
  k.type('[D');                       // ← partido: mueve el cursor
  t.mock.timers.tick(ESC_WAIT_MS * 2);
  assert.equal(k.events.esc, 0);
  assert.equal(k.st.buf, 'ab');
  assert.equal(k.st.cur, 1);
});

test('R8: a lone ESC with nothing after it acts after the wait (clears text, then interrupts)', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const k = keyboard();
  k.type('abc');
  k.type('\x1b');
  t.mock.timers.tick(ESC_WAIT_MS - 1);
  assert.equal(k.st.buf, 'abc');
  t.mock.timers.tick(1);
  assert.equal(k.st.buf, '');
  k.type('\x1b');
  t.mock.timers.tick(ESC_WAIT_MS);
  assert.equal(k.events.esc, 1);
  assert.ok(ESC_WAIT_MS >= 30 && ESC_WAIT_MS <= 100);
});

test('R8: a pasted line never answers a pending approval; a typed one does', async () => {
  let onLine = null;
  const printed = [];
  const screen = { setOnLine: (fn) => { onLine = fn; }, print: (x) => printed.push(x) };
  const inbox = tuiInput(screen, {});
  const answer = inbox.answer();
  onLine('a', { pasted: true });
  onLine('y');
  assert.equal(await answer, 'y');
  assert.equal(await inbox.next(), 'a');
});
