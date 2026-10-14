// T13 (spec 022, R22) — un PDF con varios streams comprimidos se lee entero: antes la búsqueda del
// siguiente `stream` arrancaba dentro de `endstream` y desde la página 2 el texto se perdía.

import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { pdfToText } from '../lib/docread/pdf.mjs';

const stream = (text) => {
  const data = deflateSync(Buffer.from(`BT (${text}) Tj ET`));
  return Buffer.concat([Buffer.from(`<< /Filter /FlateDecode /Length ${data.length} >>\nstream\n`), data, Buffer.from('\nendstream\nendobj\n')]);
};

test('R22: el texto de cada página comprimida aparece, en orden', () => {
  const pdf = Buffer.concat([
    Buffer.from('%PDF-1.4\n1 0 obj\n'), stream('Texto de la pagina uno'),
    Buffer.from('2 0 obj\n'), stream('Texto de la pagina dos'),
    Buffer.from('3 0 obj\n'), stream('Texto de la pagina tres')
  ]);
  const text = pdfToText(pdf);
  assert.match(text, /uno[\s\S]*dos[\s\S]*tres/);
});
