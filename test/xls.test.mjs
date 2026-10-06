// test/xls.test.mjs — hojas de cálculo sin dependencias (spec 015).
// Los libros de prueba se construyen a mano: byte a byte, sin Excel y sin fixtures binarios.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { isCompound, readCompound } from '../lib/ole2.mjs';
import { xlsToSheets, _internals } from '../lib/xls.mjs';
import { t } from '../lib/i18n.mjs';

const SECTOR = 512;

/**
 * Arma un OLE2/CFB mínimo con streams grandes (sin mini-FAT) o pequeños (con mini-FAT).
 * `files` es { nombre: Buffer }.
 */
function makeCompound(files) {
  const names = Object.keys(files);
  // Todo va por la FAT normal: fuerzo tamaños >= 4096 rellenando, así evito la mini-FAT aquí.
  const pad = (b) => (b.length >= 4096 ? b : Buffer.concat([b, Buffer.alloc(4096 - b.length)]));
  const streams = names.map((n) => ({ name: n, data: pad(files[n]), real: files[n].length }));

  const sectorsOf = (b) => Math.ceil(b.length / SECTOR);
  // layout: [FAT][dir][streams...]
  const dirSectors = Math.max(1, Math.ceil(((names.length + 1) * 128) / SECTOR));
  let cursor = 1 + dirSectors; // sector 0 = FAT, luego el directorio
  const placed = streams.map((s) => {
    const start = cursor;
    cursor += sectorsOf(s.data);
    return { ...s, start };
  });
  const totalSectors = cursor;

  const fat = Buffer.alloc(SECTOR, 0xff);
  const setFat = (i, v) => fat.writeUInt32LE(v >>> 0, i * 4);
  setFat(0, 0xfffffffd); // FATSECT
  for (let i = 0; i < dirSectors; i++) setFat(1 + i, i === dirSectors - 1 ? 0xfffffffe : 2 + i);
  for (const s of placed) {
    const n = sectorsOf(s.data);
    for (let i = 0; i < n; i++) setFat(s.start + i, i === n - 1 ? 0xfffffffe : s.start + i + 1);
  }

  const dir = Buffer.alloc(dirSectors * SECTOR);
  const writeEntry = (idx, name, type, start, size) => {
    const p = idx * 128;
    const nb = Buffer.from(name, 'utf16le');
    nb.copy(dir, p);
    dir.writeUInt16LE(nb.length + 2, p + 64);
    dir.writeUInt8(type, p + 66);
    dir.writeUInt32LE(0xffffffff, p + 68);
    dir.writeUInt32LE(0xffffffff, p + 72);
    dir.writeUInt32LE(0xffffffff, p + 76);
    dir.writeUInt32LE(start >>> 0, p + 116);
    dir.writeBigUInt64LE(BigInt(size), p + 120);
  };
  writeEntry(0, 'Root Entry', 5, 0xfffffffe, 0);
  placed.forEach((s, i) => writeEntry(i + 1, s.name, 2, s.start, s.real));

  const header = Buffer.alloc(SECTOR);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(header, 0);
  header.writeUInt16LE(9, 30); // sector = 512
  header.writeUInt16LE(6, 32); // mini = 64
  header.writeUInt32LE(1, 44); // nº de sectores FAT
  header.writeUInt32LE(1, 48); // primer sector del directorio
  header.writeUInt32LE(4096, 56); // umbral mini-stream
  header.writeUInt32LE(0xfffffffe, 60); // sin mini-FAT
  header.writeUInt32LE(0, 64);
  header.writeUInt32LE(0xfffffffe, 68); // sin DIFAT extra
  header.writeUInt32LE(0, 72);
  header.fill(0xff, 76, 512);
  header.writeUInt32LE(0, 76); // DIFAT[0] = sector 0

  const body = Buffer.alloc(totalSectors * SECTOR);
  fat.copy(body, 0);
  dir.copy(body, SECTOR);
  for (const s of placed) s.data.copy(body, s.start * SECTOR);
  return Buffer.concat([header, body]);
}

/** Concatena registros BIFF: [{id, data}] -> Buffer */
function biff(records) {
  return Buffer.concat(
    records.map(({ id, data }) => {
      const head = Buffer.alloc(4);
      head.writeUInt16LE(id, 0);
      head.writeUInt16LE(data.length, 2);
      return Buffer.concat([head, data]);
    })
  );
}

const u16 = (...v) => { const b = Buffer.alloc(v.length * 2); v.forEach((n, i) => b.writeUInt16LE(n, i * 2)); return b; };
const u32 = (...v) => { const b = Buffer.alloc(v.length * 4); v.forEach((n, i) => b.writeUInt32LE(n >>> 0, i * 4)); return b; };

/** SST con cadenas comprimidas (latin1). */
function sstRecord(strings) {
  const parts = [u32(strings.length, strings.length)];
  for (const s of strings) {
    parts.push(u16(s.length), Buffer.from([0]), Buffer.from(s, 'latin1'));
  }
  return { id: 0x00fc, data: Buffer.concat(parts) };
}

const boundsheet = (pos, name) =>
  ({ id: 0x0085, data: Buffer.concat([u32(pos), u16(0), Buffer.from([name.length, 0]), Buffer.from(name, 'latin1')]) });

const labelsst = (r, c, isst) => ({ id: 0x00fd, data: Buffer.concat([u16(r, c, 0), u32(isst)]) });
const numberRec = (r, c, v) => { const d = Buffer.alloc(14); d.writeUInt16LE(r, 0); d.writeUInt16LE(c, 2); d.writeDoubleLE(v, 6); return { id: 0x0203, data: d }; };
const rkRec = (r, c, rk) => { const d = Buffer.alloc(10); d.writeUInt16LE(r, 0); d.writeUInt16LE(c, 2); d.writeInt32LE(rk, 6); return { id: 0x027e, data: d }; };
const BOF = { id: 0x0809, data: Buffer.alloc(16) };
const EOF_REC = { id: 0x000a, data: Buffer.alloc(0) };

/**
 * Arma un .xls BIFF8 completo. `sheets` = [{ name, records }].
 * Calcula las posiciones reales de cada substream para los BOUNDSHEET.
 */
function makeXls(sst, sheets) {
  const globalsRecords = (pos) => [BOF, sstRecord(sst), ...sheets.map((s, i) => boundsheet(pos[i], s.name)), EOF_REC];
  // dos pasadas: la primera mide, la segunda escribe con las posiciones ya conocidas
  let positions = sheets.map(() => 0);
  for (let pass = 0; pass < 2; pass++) {
    const globals = biff(globalsRecords(positions));
    let at = globals.length;
    positions = sheets.map((s) => { const p = at; at += biff([BOF, ...s.records, EOF_REC]).length; return p; });
  }
  const globals = biff(globalsRecords(positions));
  const bodies = sheets.map((s) => biff([BOF, ...s.records, EOF_REC]));
  return Buffer.concat([globals, ...bodies]);
}

// ─────────────────────────────────────────────────────────── T1 · contenedor OLE2

test('isCompound reconoce la firma OLE2 y rechaza cualquier otra cosa', () => {
  const buf = makeCompound({ Workbook: Buffer.from('hola') });
  assert.equal(isCompound(buf), true);
  assert.equal(isCompound(Buffer.from('PK esto es un zip')), false);
  assert.equal(isCompound(Buffer.alloc(3)), false);
});

test('readCompound entrega el stream por nombre, con su tamaño real', () => {
  const payload = Buffer.from('contenido del libro');
  const { read, entries } = readCompound(makeCompound({ Workbook: payload }));
  assert.ok(entries.some((e) => e.name === 'Workbook'));
  assert.deepEqual(read('Workbook'), payload);
});

test('readCompound devuelve null si el stream no existe', () => {
  const { read } = readCompound(makeCompound({ Workbook: Buffer.from('x') }));
  assert.equal(read('NoExiste'), null);
});

test('readCompound recorre cadenas de varios sectores sin truncar', () => {
  const big = Buffer.alloc(5000, 0x41); // > 4096: obliga a encadenar sectores
  const { read } = readCompound(makeCompound({ Workbook: big }));
  assert.equal(read('Workbook').length, 5000);
  assert.deepEqual(read('Workbook'), big);
});

// ─────────────────────────────────────────────────────────── T3 · BIFF8

test('xlsToSheets lee cadenas del SST y las coloca en su fila/columna (R2, R5)', () => {
  const xls = makeXls(['Nombre', 'Valor'], [
    { name: 'Datos', records: [labelsst(0, 0, 0), labelsst(0, 1, 1)] }
  ]);
  const sheets = xlsToSheets(makeCompound({ Workbook: xls }));
  assert.equal(sheets.length, 1);
  assert.equal(sheets[0].name, 'Datos');
  assert.deepEqual(sheets[0].rows, [['Nombre', 'Valor']]);
});

test('xlsToSheets emite el valor de las celdas numéricas, no la fórmula (R7)', () => {
  // RK con bit de entero: (7700000 << 2) | 2
  const xls = makeXls([], [
    { name: 'Cifras', records: [numberRec(0, 0, 117600000), rkRec(1, 0, (7700000 << 2) | 2)] }
  ]);
  const [hoja] = xlsToSheets(makeCompound({ Workbook: xls }));
  assert.deepEqual(hoja.rows, [['117600000'], ['7700000']]);
});

test('xlsToSheets conserva la columna vacía intermedia y recorta la del final (R5)', () => {
  const xls = makeXls(['A', 'C'], [
    { name: 'Huecos', records: [labelsst(0, 0, 0), labelsst(0, 2, 1)] }
  ]);
  const [hoja] = xlsToSheets(makeCompound({ Workbook: xls }));
  assert.deepEqual(hoja.rows, [['A', '', 'C']]);
});

test('xlsToSheets omite las hojas sin ninguna celda con contenido (R6)', () => {
  const xls = makeXls(['dato'], [
    { name: 'Vacía', records: [] },
    { name: 'Llena', records: [labelsst(0, 0, 0)] }
  ]);
  const sheets = xlsToSheets(makeCompound({ Workbook: xls }));
  assert.deepEqual(sheets.map((s) => s.name), ['Llena']);
});

test('el SST reconstruye cadenas partidas entre registros CONTINUE', () => {
  // Una cadena de 300 caracteres no cabe en el primer trozo y sigue en un CONTINUE.
  const largo = 'x'.repeat(300);
  const head = Buffer.concat([u32(1, 1), u16(largo.length), Buffer.from([0]), Buffer.from(largo.slice(0, 100), 'latin1')]);
  const cont = Buffer.concat([Buffer.from([0]), Buffer.from(largo.slice(100), 'latin1')]);
  const recs = [
    { id: 0x00fc, data: head },
    { id: 0x003c, data: cont }
  ];
  const strings = _internals.parseSST(_internals.records(biff(recs)), 0);
  assert.equal(strings[0], largo);
});

test('un registro BIFF desconocido no aborta la lectura de la hoja', () => {
  const xls = makeXls(['ok'], [
    { name: 'Rara', records: [{ id: 0x1234, data: Buffer.alloc(8, 0xaa) }, labelsst(0, 0, 0)] }
  ]);
  const [hoja] = xlsToSheets(makeCompound({ Workbook: xls }));
  assert.deepEqual(hoja.rows, [['ok']]);
});

// ─────────────────────────────────────────────────────────── T5 · cifrado RC4

const md5 = (b) => createHash('md5').update(b).digest();

/** Cifra un stream BIFF igual que Excel, para poder probar el descifrado. */
function encryptStream(stream, password, salt) {
  const out = Buffer.from(stream);
  const plain = new Set([0x0809, 0x002f, 0x00e1, 0x0194, 0x0195, 0x0196, 0x0138]);
  const enc = new Uint8Array(stream.length);
  for (const r of _internals.records(stream)) {
    if (plain.has(r.id)) continue;
    for (let i = 0; i < r.len; i++) enc[r.pos + 4 + i] = 1;
  }
  for (const r of _internals.records(stream)) if (r.id === 0x0085) for (let i = 0; i < 4; i++) enc[r.pos + 4 + i] = 0;
  let next = null;
  for (let pos = 0; pos < stream.length; pos++) {
    if (pos % 1024 === 0) next = _internals.rc4(_internals.deriveKey(password, salt, pos / 1024));
    const ks = next();
    if (enc[pos]) out[pos] = stream[pos] ^ ks;
  }
  return out;
}

/** Registro FILEPASS RC4 estándar (54 bytes) para la contraseña dada. */
function filepass(password, salt) {
  const verifier = Buffer.alloc(16, 0x5a);
  const key = _internals.deriveKey(password, salt, 0);
  const enc = _internals.rc4Apply(key, Buffer.concat([verifier, md5(verifier)]));
  return { id: 0x002f, data: Buffer.concat([u16(1, 1, 1), salt, enc]) };
}

test('deriveKey + verificador aceptan la contraseña correcta y rechazan la falsa (R3, R4)', () => {
  const salt = Buffer.alloc(16, 0x11);
  const fp = filepass('VelvetSweatshop', salt).data;
  assert.equal(_internals.verifyPassword('VelvetSweatshop', salt, fp.subarray(22, 38), fp.subarray(38, 54)), true);
  assert.equal(_internals.verifyPassword('otra-clave', salt, fp.subarray(22, 38), fp.subarray(38, 54)), false);
});

test('un libro cifrado con la clave por defecto de Excel se lee sin pedir nada (R3)', () => {
  const salt = Buffer.alloc(16, 0x22);
  const sheets = [{ name: 'Protegida', records: [labelsst(0, 0, 0), labelsst(0, 1, 1)] }];
  // el FILEPASS va justo detrás del BOF de los globals, como hace Excel
  const globalsExtra = filepass('VelvetSweatshop', salt);
  const plainStream = (() => {
    const base = makeXls(['Modelo', 'Financiero'], sheets);
    // reinserto el FILEPASS tras el primer BOF y recoloco posiciones rehaciendo el libro
    const recs = _internals.records(base);
    const head = recs[0];
    const rest = base.subarray(head.pos + 4 + head.len);
    return Buffer.concat([base.subarray(0, head.pos + 4 + head.len), biff([globalsExtra]), rest]);
  })();
  // las posiciones de BOUNDSHEET se desplazaron por el FILEPASS: las corrijo
  const shift = 4 + globalsExtra.data.length;
  for (const r of _internals.records(plainStream)) {
    if (r.id === 0x0085) plainStream.writeUInt32LE(plainStream.readUInt32LE(r.pos + 4) + shift, r.pos + 4);
  }
  const cifrado = encryptStream(plainStream, 'VelvetSweatshop', salt);
  const out = xlsToSheets(makeCompound({ Workbook: cifrado }));
  assert.deepEqual(out.map((s) => s.name), ['Protegida']);
  assert.deepEqual(out[0].rows, [['Modelo', 'Financiero']]);
});

test('un libro con contraseña real falla con el mensaje de protegido, no con basura (R4)', () => {
  const salt = Buffer.alloc(16, 0x33);
  const base = makeXls(['secreto'], [{ name: 'H', records: [labelsst(0, 0, 0)] }]);
  const recs = _internals.records(base);
  const head = recs[0];
  const fp = filepass('clave-de-verdad', salt);
  const plainStream = Buffer.concat([base.subarray(0, head.pos + 4 + head.len), biff([fp]), base.subarray(head.pos + 4 + head.len)]);
  const cifrado = encryptStream(plainStream, 'clave-de-verdad', salt);
  assert.throws(() => xlsToSheets(makeCompound({ Workbook: cifrado })), (e) => e.message === t('docXlsEncrypted'));
});
