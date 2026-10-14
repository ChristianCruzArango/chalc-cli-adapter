// T10 (spec 022, R18, F13) — mutantes: los topes de los lectores de documentos (PDF, .xlsx, .xls, ZIP)
// se prueban en su FRONTERA exacta (justo en el tope pasa, uno más lanza DOC_TOO_LARGE).

import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync, deflateRawSync } from 'node:zlib';
import { pdfToText } from '../lib/docread/pdf.mjs';
import { xlsxToSheets, colIndex } from '../lib/docread/sheets.mjs';
import { inflateLimited, MAX_INFLATE, MAX_ROWS, MAX_COLS } from '../lib/docread/zip.mjs';
import { docTooLarge, isDocTooLarge, DOC_TOO_LARGE } from '../lib/docread/toolarge.mjs';
import { xlsToSheets } from '../lib/xls.mjs';
import { t } from '../lib/i18n.mjs';
import { makeZip } from './helpers/zip.mjs';

const tooLarge = (e) => e.code === DOC_TOO_LARGE;
const MB = 1024 * 1024;

// ── toolarge ─────────────────────────────────────────────────────────────────────────────────────
test('docTooLarge lleva el mensaje traducido y su code; isDocTooLarge tolera null', () => {
  const err = docTooLarge();
  assert.equal(err.message, t('docTooLarge'));
  assert.ok(err.message.length > 0);
  assert.equal(isDocTooLarge(err), true);
  assert.equal(isDocTooLarge(null), false);
  assert.equal(isDocTooLarge(undefined), false);
  assert.equal(isDocTooLarge(new Error('x')), false);
});

// ── zip: inflateLimited ──────────────────────────────────────────────────────────────────────────
test('inflateLimited: un RangeError del inflador se traduce a DOC_TOO_LARGE', () => {
  assert.throws(() => inflateLimited(() => { throw new RangeError('heap'); }, Buffer.alloc(0)), tooLarge);
});

test('inflateLimited: ERR_BUFFER_TOO_LARGE (sin ser RangeError) también es DOC_TOO_LARGE', () => {
  const err = Object.assign(new Error('grande'), { code: 'ERR_BUFFER_TOO_LARGE' });
  assert.throws(() => inflateLimited(() => { throw err; }, Buffer.alloc(0)), tooLarge);
});

test('inflateLimited: cualquier otro error se propaga tal cual; un throw de null también', () => {
  const other = Object.assign(new Error('datos corruptos'), { code: 'Z_DATA_ERROR' });
  assert.throws(() => inflateLimited(() => { throw other; }, Buffer.alloc(0)), (e) => e === other);
  assert.throws(() => inflateLimited(() => { throw null; }, Buffer.alloc(0)), (e) => e === null);
});

test('inflateLimited pasa el tope de salida al inflador', () => {
  let seen;
  inflateLimited((raw, opts) => { seen = opts; return raw; }, Buffer.alloc(1));
  assert.deepEqual(seen, { maxOutputLength: MAX_INFLATE });
});

// ── pdf ──────────────────────────────────────────────────────────────────────────────────────────
const TEXT = 'BT /F1 12 Tf (Hola mundo desde un stream comprimido) Tj ET';
const pdf = (...streams) => Buffer.concat(['%PDF-1.4\n', ...streams.flatMap((s) => ['1 0 obj\n<<>>\nstream\n', s, '\nendstream\nendobj\n'])]
  .map((x) => (Buffer.isBuffer(x) ? x : Buffer.from(x))));
// Streams encadenados `z1 endstream z2 endstream …`: el lector procesa cada uno (también los
// siguientes al primero), así varios streams grandes suman hacia el tope total.
const chained = (...streams) => Buffer.concat([Buffer.from('%PDF-1.4\nstream\n'), ...streams.flatMap((s) => [s, Buffer.from('endstream')])]);

test('pdf: extrae el texto de un stream zlib', () => {
  assert.equal(pdfToText(pdf(deflateSync(Buffer.from(TEXT)))), 'Hola mundo desde un stream comprimido');
});

test('pdf: si zlib falla, extrae el texto de un stream deflate crudo', () => {
  assert.equal(pdfToText(pdf(deflateRawSync(Buffer.from(TEXT)))), 'Hola mundo desde un stream comprimido');
});

test('pdf: una bomba en deflate crudo también se corta con DOC_TOO_LARGE', () => {
  const bomb = deflateRawSync(Buffer.alloc(MAX_INFLATE + 1024, 0x20));
  assert.throws(() => pdfToText(pdf(bomb)), tooLarge);
});

test('pdf: varios streams que juntos superan el tope total lanzan DOC_TOO_LARGE', () => {
  const part = deflateSync(Buffer.alloc(48 * MB, 0x20));
  assert.throws(() => pdfToText(chained(part, part, part, part, part)), tooLarge);
});

test('pdf: exactamente en el tope total no lanza', () => {
  const full = deflateSync(Buffer.alloc(MAX_INFLATE, 0x20));
  assert.equal(pdfToText(chained(full, full)), '');
});

// ── xlsx ─────────────────────────────────────────────────────────────────────────────────────────
function xlsx(rowsXml) {
  return makeZip({
    'xl/workbook.xml': '<workbook><sheets><sheet name="H" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': `<worksheet><sheetData>${rowsXml}</sheetData></worksheet>`
  });
}
// Letras de columna para un índice base 0 (0 → A, 16383 → XFD).
function letters(index) {
  let n = index + 1;
  let out = '';
  while (n > 0) { const r = (n - 1) % 26; out = String.fromCharCode(65 + r) + out; n = Math.floor((n - 1) / 26); }
  return out;
}
const cell = (row, col) => `<c r="${letters(col)}${row}"><v>1</v></c>`;
const row = (r, ...cols) => `<row r="${r}">${cols.map((c) => cell(r, c)).join('')}</row>`;

test('xlsx: letters() concuerda con colIndex en la frontera de columnas', () => {
  assert.equal(letters(MAX_COLS - 1), 'XFD');
  assert.equal(colIndex('XFD1'), MAX_COLS - 1);
  assert.equal(colIndex(letters(MAX_COLS)), MAX_COLS);
});

test('xlsx: la última columna de Excel se acepta; una más allá es DOC_TOO_LARGE', () => {
  const [hoja] = xlsxToSheets(xlsx(row(1, MAX_COLS - 1)));
  assert.equal(hoja.rows[0].length, MAX_COLS);
  assert.equal(hoja.rows[0][MAX_COLS - 1], '1');
  assert.throws(() => xlsxToSheets(xlsx(row(1, MAX_COLS))), tooLarge);
});

test('xlsx: la última fila de Excel se acepta; una más allá es DOC_TOO_LARGE', () => {
  const [hoja] = xlsxToSheets(xlsx(row(MAX_ROWS, 0)));
  assert.equal(hoja.rows.length, MAX_ROWS);
  assert.deepEqual(hoja.rows.at(-1), ['1']);
  assert.throws(() => xlsxToSheets(xlsx(row(MAX_ROWS + 1, 0))), tooLarge);
});

test('xlsx: una fila r="0" (índice negativo) es DOC_TOO_LARGE', () => {
  assert.throws(() => xlsxToSheets(xlsx(row(0, 0))), tooLarge);
});

// 305 filas con la última columna (16384 celdas + 1 de fila cada una) = 4.997.425; una fila más con
// la columna c suma c + 2: c = 2573 llega justo a 5.000.000 (el tope) y c = 2574 lo pasa.
const cellsBudget = (lastCol) => {
  let xml = '';
  for (let r = 1; r <= 305; r++) xml += row(r, MAX_COLS - 1);
  return xlsx(xml + row(306, lastCol));
};

test('xlsx: exactamente en el tope de celdas materializadas no lanza', () => {
  const [hoja] = xlsxToSheets(cellsBudget(2573));
  assert.equal(hoja.rows.length, 306);
  assert.equal(hoja.rows[305].length, 2574);
});

test('xlsx: una celda materializada más allá del tope es DOC_TOO_LARGE', () => {
  assert.throws(() => xlsxToSheets(cellsBudget(2574)), tooLarge);
});

// ── xls (BIFF8 dentro de OLE2) ───────────────────────────────────────────────────────────────────
const SECTOR = 512;
const u16 = (...v) => { const b = Buffer.alloc(v.length * 2); v.forEach((n, i) => b.writeUInt16LE(n, i * 2)); return b; };
const u32 = (...v) => { const b = Buffer.alloc(v.length * 4); v.forEach((n, i) => b.writeUInt32LE(n >>> 0, i * 4)); return b; };
const biff = (records) => Buffer.concat(records.flatMap(({ id, data }) => [u16(id, data.length), data]));
const rk = (r, c) => { const d = Buffer.alloc(10); d.writeUInt16LE(r, 0); d.writeUInt16LE(c, 2); d.writeInt32LE((1 << 2) | 2, 6); return { id: 0x027e, data: d }; };
const BOF = { id: 0x0809, data: Buffer.alloc(16) };
const EOF_REC = { id: 0x000a, data: Buffer.alloc(0) };
const boundsheet = (pos) => ({ id: 0x0085, data: Buffer.concat([u32(pos), u16(0), Buffer.from([1, 0]), Buffer.from('H', 'latin1')]) });

// Libro de una hoja: los globales miden siempre lo mismo, así la posición de la hoja se conoce de antemano.
function workbook(cells) {
  const pos = biff([BOF, boundsheet(0), EOF_REC]).length;
  return Buffer.concat([biff([BOF, boundsheet(pos), EOF_REC]), biff([BOF, ...cells, EOF_REC])]);
}

// OLE2 con un solo stream por la FAT normal, con tantos sectores de FAT como haga falta (DIFAT en cabecera).
function compound(stream) {
  const data = Buffer.concat([stream, Buffer.alloc(Math.max(0, 4096 - stream.length))]);
  const dataSectors = Math.ceil(data.length / SECTOR);
  let nFat = 1;
  while (nFat * 128 < nFat + 1 + dataSectors) nFat++;
  const dirSector = nFat;
  const start = nFat + 1;
  const fat = Buffer.alloc(nFat * SECTOR, 0xff);
  const setFat = (i, v) => fat.writeUInt32LE(v >>> 0, i * 4);
  for (let i = 0; i < nFat; i++) setFat(i, 0xfffffffd);
  setFat(dirSector, 0xfffffffe);
  for (let i = 0; i < dataSectors; i++) setFat(start + i, i === dataSectors - 1 ? 0xfffffffe : start + i + 1);
  const dir = Buffer.alloc(SECTOR);
  const entry = (idx, name, type, first, size) => {
    const p = idx * 128;
    const nb = Buffer.from(name, 'utf16le');
    nb.copy(dir, p);
    dir.writeUInt16LE(nb.length + 2, p + 64);
    dir.writeUInt8(type, p + 66);
    dir.fill(0xff, p + 68, p + 80);
    dir.writeUInt32LE(first >>> 0, p + 116);
    dir.writeBigUInt64LE(BigInt(size), p + 120);
  };
  entry(0, 'Root Entry', 5, 0xfffffffe, 0);
  entry(1, 'Workbook', 2, start, stream.length);
  const header = Buffer.alloc(SECTOR);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(header, 0);
  header.writeUInt16LE(9, 30);
  header.writeUInt16LE(6, 32);
  header.writeUInt32LE(nFat, 44);
  header.writeUInt32LE(dirSector, 48);
  header.writeUInt32LE(4096, 56);
  header.writeUInt32LE(0xfffffffe, 60);
  header.writeUInt32LE(0xfffffffe, 68);
  header.fill(0xff, 76, 512);
  for (let i = 0; i < nFat; i++) header.writeUInt32LE(i, 76 + i * 4);
  const body = Buffer.alloc(dataSectors * SECTOR);
  data.copy(body);
  return Buffer.concat([header, fat, dir, body]);
}

// 65536 filas (+1 cada una) + 19275 filas con la columna 255 (+256) + la fila 65535 con la columna 0 (+1)
// = 4.999.937; la fila 19275 con la columna c suma c + 1: c = 62 llega justo a 5.000.000 y c = 63 lo pasa.
const xlsBudget = (lastCol) => {
  const cells = [];
  for (let r = 0; r < 19275; r++) cells.push(rk(r, 255));
  cells.push(rk(19275, lastCol), rk(65535, 0));
  return compound(workbook(cells));
};

test('xls: exactamente en el tope de celdas materializadas no lanza', () => {
  const [hoja] = xlsToSheets(xlsBudget(62));
  assert.equal(hoja.rows.length, 65536);
  assert.equal(hoja.rows[0][255], '1');
});

test('xls: una celda materializada más allá del tope es DOC_TOO_LARGE', () => {
  assert.throws(() => xlsToSheets(xlsBudget(63)), tooLarge);
});
