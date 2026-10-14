// T6 (spec 022, R18, F13) — el "documento demasiado grande" se reconoce por su `code`, no comparando
// el mensaje traducido: así no depende del idioma activo.

import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync, inflateSync } from 'node:zlib';
import { inflateLimited, MAX_INFLATE } from '../lib/docread/zip.mjs';
import { pdfToText } from '../lib/docread/pdf.mjs';

const bomb = () => deflateSync(Buffer.alloc(MAX_INFLATE + 1024, 0x20));

test('F13: inflateLimited lanza un error con code DOC_TOO_LARGE', () => {
  assert.throws(() => inflateLimited(inflateSync, bomb()), (e) => e.code === 'DOC_TOO_LARGE');
});

test('F13: un stream de PDF que excede el tope se propaga con su code', () => {
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nstream\n'), bomb(), Buffer.from('\nendstream\nendobj\n')]);
  assert.throws(() => pdfToText(pdf), (e) => e.code === 'DOC_TOO_LARGE');
});

// T12 (spec 022, R18, F13) — ningún lector lanza el error sin code: todos pasan por docTooLarge().
test('F13: ningún archivo de lib/ construye a mano el error docTooLarge', async () => {
  const { readdir, readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const offenders = [];
  for (const dir of ['lib', 'lib/docread']) {
    for (const f of await readdir(dir)) {
      if (!f.endsWith('.mjs') || f === 'toolarge.mjs') continue;
      if (/new Error\(t\('docTooLarge'/.test(await readFile(join(dir, f), 'utf8'))) offenders.push(`${dir}/${f}`);
    }
  }
  assert.deepEqual(offenders, []);
});
