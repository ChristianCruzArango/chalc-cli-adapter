// Tests del selector inline con flechas (cli/ui/select.mjs) usando un stream simulado con teclas reales.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { selectInline } from '../cli/ui/select.mjs';

// Input falso tipo TTY: PassThrough + los métodos que usa el selector.
function fakeTty() {
  const input = new PassThrough();
  input.isTTY = true;
  input.isRaw = false;
  input.setRawMode = (v) => { input.isRaw = v; return input; };
  const output = new PassThrough();
  output.isTTY = true;
  return { input, output };
}

test('selectInline: flecha derecha + enter elige la segunda opción', async () => {
  const { input, output } = fakeTty();
  const p = selectInline('¿ejecutar?', ['Sí', 'No'], { input, output });
  input.write('\x1b[C');   // →
  input.write('\r');       // enter
  assert.equal(await p, 1);
});

test('selectInline: enter directo elige la primera; ESC cancela con null', async () => {
  const a = fakeTty();
  const pa = selectInline('q', ['Sí', 'No'], { input: a.input, output: a.output });
  a.input.write('\r');
  assert.equal(await pa, 0);

  const b = fakeTty();
  const pb = selectInline('q', ['Sí', 'No'], { input: b.input, output: b.output });
  b.input.write('\x1b');   // ESC solitario: readline lo emite como {name:'escape'} de inmediato
  assert.equal(await pb, null);
});

test('selectInline: atajos y/n sin flechas', async () => {
  const a = fakeTty();
  const pa = selectInline('q', ['Sí', 'No'], { input: a.input, output: a.output });
  a.input.write('n');
  assert.equal(await pa, 1);

  const b = fakeTty();
  const pb = selectInline('q', ['Sí', 'No'], { input: b.input, output: b.output });
  b.input.write('y');
  assert.equal(await pb, 0);
});

test('selectInline sin TTY devuelve null (el llamador cae a pregunta de texto)', async () => {
  const input = new PassThrough();   // sin isTTY
  assert.equal(await selectInline('q', ['a', 'b'], { input, output: new PassThrough() }), null);
});
