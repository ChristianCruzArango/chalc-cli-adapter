// S-09 — un documento pequeño y fabricado no puede agotar la memoria ni colgar la lectura.
//
// Cada caso corre en un proceso hijo con el heap recortado a 96 MB: antes de la corrección, un XLSX
// de 382 bytes abortaba el proceso (SIGABRT, un error fatal que ningún try/catch captura) y un
// OLE2 de 1 KB subía a 2,4 GB de RSS. Ahora cada uno termina con un error legible.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeZip } from './helpers/zip.mjs';

const dir = mkdtempSync(join(tmpdir(), 'chalc-s09-'));
const lib = (name) => pathToFileURL(fileURLToPath(new URL(`../lib/${name}`, import.meta.url))).href;

// Ejecuta `call` (código que devuelve una promesa o un valor) sobre el archivo en un hijo limitado.
function inChild(file, call) {
  const code = `const buf = require('node:fs').readFileSync(${JSON.stringify(file)});
    (async () => { try { await (${call}); console.log('READ'); } catch (e) { console.log('ERR ' + e.message); } })();`;
  const r = spawnSync(process.execPath, ['--max-old-space-size=96', '--input-type=commonjs', '-e', code], { encoding: 'utf8', timeout: 20000 });
  return { status: r.status, signal: r.signal, out: (r.stdout || '').trim() };
}

const xlsx = (sheetXml) => makeZip({
  'xl/workbook.xml': '<workbook><sheets><sheet name="S" sheetId="1"/></sheets></workbook>',
  'xl/worksheets/sheet1.xml': `<worksheet><sheetData>${sheetXml}</sheetData></worksheet>`
});

function save(name, buf) { const f = join(dir, name); writeFileSync(f, buf); return f; }

const XLSX_CALL = `import(${JSON.stringify(lib('docread.mjs'))}).then((m) => m._internals.xlsxToSheets(buf))`;
const DOCX_CALL = `import(${JSON.stringify(lib('docread.mjs'))}).then((m) => m._internals.docxToText(buf))`;
const OLE_CALL = `import(${JSON.stringify(lib('ole2.mjs'))}).then((m) => m.readCompound(buf).read('Workbook'))`;

test('an XLSX row index beyond Excel limits is rejected, not allocated', () => {
  const r = inChild(save('row.xlsx', xlsx('<row r="2147483647"><c r="A2147483647" t="inlineStr"><is><t>x</t></is></c></row>')), XLSX_CALL);
  assert.equal(r.signal, null);
  assert.match(r.out, /^ERR .*(límite|limit)/);
});

test('an XLSX with a far column and a far row is rejected', () => {
  const r = inChild(save('far.xlsx', xlsx('<row r="1"><c r="XFD1"><v>1</v></c></row><row r="300000000"><c r="A300000000"><v>1</v></c></row>')), XLSX_CALL);
  assert.equal(r.signal, null);
  assert.match(r.out, /^ERR /);
});

test('a normal XLSX still reads', () => {
  const r = inChild(save('ok.xlsx', xlsx('<row r="1"><c r="A1"><v>1</v></c><c r="C1"><v>3</v></c></row>')), XLSX_CALL);
  assert.equal(r.out, 'READ');
});

test('a zip bomb disguised as DOCX stops at the inflate limit', () => {
  const bomb = makeZip({ 'word/document.xml': Buffer.alloc(80 * 1024 * 1024, 0x20) });
  assert.ok(bomb.length < 200 * 1024);
  const r = inChild(save('bomb.docx', bomb), DOCX_CALL);
  assert.equal(r.signal, null);
  assert.match(r.out, /^ERR .*(límite|limit)/);
});

// Cabecera OLE2 de 512 bytes con DIFAT y FAT controlables.
function ole({ secShift = 9, dirStart = 0, difatStart = 0xfffffffe, difatCount = 0, sectors = [] } = {}) {
  const header = Buffer.alloc(512);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(header, 0);
  header.writeUInt16LE(secShift, 30);
  header.writeUInt16LE(6, 32);
  header.writeUInt32LE(dirStart, 48);
  header.writeUInt32LE(4096, 56);
  header.writeUInt32LE(0xfffffffe, 60);
  header.writeUInt32LE(difatStart, 68);
  header.writeUInt32LE(difatCount, 72);
  header.fill(0xff, 76, 512);
  header.writeUInt32LE(0, 76);
  return Buffer.concat([header, ...sectors]);
}

test('an OLE2 DIFAT sector that points to itself is detected as a cycle', () => {
  const self = Buffer.alloc(512, 0xff);
  self.writeUInt32LE(1, 508);   // el siguiente sector DIFAT es él mismo
  const fat = Buffer.alloc(512, 0xff);
  const r = inChild(save('difat.xls', ole({ difatStart: 1, difatCount: 0xffffffff, sectors: [fat, self] })), OLE_CALL);
  assert.equal(r.signal, null);
  assert.match(r.out, /^ERR OLE2: (cadena DIFAT circular|circular DIFAT chain)/);
});

test('an OLE2 FAT chain that loops is detected as a cycle', () => {
  const fat = Buffer.alloc(512, 0xff);
  fat.writeUInt32LE(0xfffffffd, 0);
  fat.writeUInt32LE(1, 4);      // el directorio (sector 1) apunta a sí mismo
  const r = inChild(save('fat.xls', ole({ dirStart: 1, sectors: [fat, Buffer.alloc(512)] })), OLE_CALL);
  assert.equal(r.signal, null);
  assert.match(r.out, /^ERR OLE2: (cadena de sectores circular|circular sector chain)/);
});

test('an OLE2 sector size other than 512 or 4096 is rejected', () => {
  const r = inChild(save('sec.xls', ole({ secShift: 20 })), OLE_CALL);
  assert.match(r.out, /^ERR OLE2: (tamaño de sector no válido|invalid sector size)/);
});
