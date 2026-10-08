// lib/xls.mjs — libros Excel binarios (.xls, BIFF8) a filas de texto, sin dependencias.
//
// Un .xls es un contenedor OLE2 (lib/ole2.mjs) con un stream "Workbook" dentro, y ese stream es
// una tira de registros [id:2][len:2][datos]. Aquí solo se leen los registros que llevan valor de
// celda; cualquier otro se ignora sin romper, que es lo que permite abrir libros reales.
//
// Los formularios institucionales suelen venir marcados "solo lectura recomendada", lo que en
// BIFF8 significa cifrado RC4 con una contraseña que Excel escribe sola y publica la
// especificación ([MS-OFFCRYPTO]). No es una protección: es un flag. Ver DEFAULT_PASSWORD.

import { readCompound } from './ole2.mjs';
import { t } from './i18n.mjs';
import { RC4_BLOCK, deriveKey, rc4, rc4Apply, verifyPassword } from './xls-crypto.mjs';

const MAX_XLS_COLS = 256;            // BIFF8
const MAX_XLS_CELLS = 5_000_000;     // celdas materializadas (huecos incluidos) por libro

// La clave que Excel graba al marcar un libro "solo lectura recomendada". Está en la
// especificación de Microsoft y Excel la aplica sin preguntar: el usuario nunca la teclea.
const DEFAULT_PASSWORD = 'VelvetSweatshop';

const RECORD = {
  BOF: 0x0809, EOF: 0x000a, FILEPASS: 0x002f, BOUNDSHEET: 0x0085,
  SST: 0x00fc, CONTINUE: 0x003c,
  LABELSST: 0x00fd, NUMBER: 0x0203, RK: 0x027e, MULRK: 0x00bd,
  FORMULA: 0x0006, STRING: 0x0207, BOOLERR: 0x0205, LABEL: 0x0204
};

// Registros cuyo contenido viaja en claro aunque el libro esté cifrado ([MS-XLS] 2.2.10):
// son los que Excel necesita leer ANTES de conocer la contraseña.
const PLAIN_RECORDS = new Set([
  RECORD.BOF, RECORD.FILEPASS, 0x00e1 /* INTERFACEHDR */, 0x0194 /* USREXCL */,
  0x0195 /* FILELOCK */, 0x0196 /* RRDINFO */, 0x0138 /* RRDHEAD */
]);

/**
 * Descifra el stream ENTERO de una pasada.
 *
 * El keystream avanza sobre todos los bytes —cabeceras de registro incluidas— aunque esas
 * cabeceras viajen en claro, y se reinicia cada 1024 bytes. Por eso se recorre posicionalmente en
 * vez de registro a registro: es donde se rompen las implementaciones que descifran "por trozos".
 */
function decryptStream(stream, password, salt) {
  const out = Buffer.from(stream);
  const encrypted = new Uint8Array(stream.length);
  for (const r of records(stream)) {
    if (PLAIN_RECORDS.has(r.id)) continue;
    for (let i = 0; i < r.len; i++) encrypted[r.pos + 4 + i] = 1;
    // en BOUNDSHEET la posición del substream (4 primeros bytes) no se cifra: Excel la necesita
    // para saltar a cada hoja sin descifrar el libro entero
    if (r.id === RECORD.BOUNDSHEET) for (let i = 0; i < 4; i++) encrypted[r.pos + 4 + i] = 0;
  }
  let next = null;
  for (let pos = 0; pos < stream.length; pos++) {
    if (pos % RC4_BLOCK === 0) next = rc4(deriveKey(password, salt, pos / RC4_BLOCK));
    const ks = next();
    if (encrypted[pos]) out[pos] = stream[pos] ^ ks;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────── registros BIFF

/** Trocea el stream en registros. Las cabeceras nunca se cifran, así que esto vale siempre. */
function records(stream) {
  const out = [];
  let p = 0;
  while (p + 4 <= stream.length) {
    const id = stream.readUInt16LE(p);
    const len = stream.readUInt16LE(p + 2);
    if (p + 4 + len > stream.length) break;
    out.push({ id, pos: p, len, data: stream.subarray(p + 4, p + 4 + len) });
    p += 4 + len;
  }
  return out;
}

/**
 * Tabla de cadenas compartidas. El punto delicado: una cadena puede partirse entre el registro SST
 * y varios CONTINUE, y cada trozo REANUNCIA si viene comprimido (latin1) o en UTF-16.
 */
// Cursor sobre el SST y sus registros CONTINUE: una cadena puede empezar en un registro y seguir en
// el siguiente. `next()` salta al siguiente CONTINUE y dice si lo había.
function sstCursor(recs, index) {
  const cur = { buf: recs[index].data, p: 8, j: index };
  cur.next = () => {
    if (cur.j + 1 >= recs.length || recs[cur.j + 1].id !== RECORD.CONTINUE) return false;
    cur.j += 1;
    cur.buf = recs[cur.j].data;
    cur.p = 0;
    return true;
  };
  return cur;
}

// Los caracteres de una cadena (`cch`), leyendo de los trozos que haga falta. Al saltar de trozo, el
// nuevo vuelve a anunciar si los caracteres son de 1 o 2 bytes.
function sstChars(cur, cch, wide) {
  let text = '';
  for (let left = cch; left > 0;) {
    const width = wide ? 2 : 1;
    const available = cur.buf.length - cur.p;
    const take = available > 0 ? Math.min(left, Math.floor(available / width)) : 0;
    if (take <= 0) {
      if (!cur.next()) break;
      wide = cur.buf.readUInt8(cur.p) & 1;
      cur.p += 1;
      continue;
    }
    text += wide ? cur.buf.toString('utf16le', cur.p, cur.p + take * 2) : cur.buf.subarray(cur.p, cur.p + take).toString('latin1');
    cur.p += take * width;
    left -= take;
  }
  return text;
}

// Una entrada del SST: cabecera (longitud, flags y extras opcionales) y texto. null si se acabó.
function sstString(cur) {
  if (cur.p + 3 > cur.buf.length && !cur.next()) return null;
  const cch = cur.buf.readUInt16LE(cur.p);
  const flags = cur.buf.readUInt8(cur.p + 2);
  cur.p += 3;
  let runs = 0;
  let extLen = 0;
  if ((flags >> 3) & 1) { runs = cur.buf.readUInt16LE(cur.p); cur.p += 2; }   // texto enriquecido
  if ((flags >> 2) & 1) { extLen = cur.buf.readUInt32LE(cur.p); cur.p += 4; } // extensión asiática
  const text = sstChars(cur, cch, flags & 1);
  cur.p += runs * 4 + extLen;
  return text;
}

function parseSST(recs, index) {
  const unique = recs[index].data.readUInt32LE(4);
  const cur = sstCursor(recs, index);
  const strings = [];
  while (strings.length < unique) {
    const text = sstString(cur);
    if (text === null) break;
    strings.push(text);
  }
  return strings;
}

/** Número RK: 30 bits que codifican un entero o un double truncado, con /100 opcional. */
function rkNum(rk) {
  let value;
  if (rk & 2) {
    value = rk >> 2;
  } else {
    const b = Buffer.alloc(8);
    b.writeInt32LE(rk & 0xfffffffc, 4); // los 30 bits altos de un double; el resto son ceros
    value = b.readDoubleLE(0);
  }
  return rk & 1 ? value / 100 : value;
}

/** Cadena corta con longitud en 1 byte y flag de ancho (ShortXLUnicodeString). */
function shortString(buf, offset) {
  const cch = buf.readUInt8(offset);
  const wide = buf.readUInt8(offset + 1) & 1;
  return wide
    ? buf.toString('utf16le', offset + 2, offset + 2 + cch * 2)
    : buf.subarray(offset + 2, offset + 2 + cch).toString('latin1');
}

/** Cadena con longitud en 2 bytes (XLUnicodeString), como la del registro STRING. */
function longString(buf, offset) {
  const cch = buf.readUInt16LE(offset);
  const wide = buf.readUInt8(offset + 2) & 1;
  return wide
    ? buf.toString('utf16le', offset + 3, offset + 3 + cch * 2)
    : buf.subarray(offset + 3, offset + 3 + cch).toString('latin1');
}

/** Convierte el número que Excel guarda a texto sin arrastrar el ruido del binario a decimal. */
function numToText(n) {
  if (!Number.isFinite(n)) return '';
  // 656304000.0000001 es el mismo número que 656304000: 15 dígitos significativos lo dejan limpio
  return String(Number.parseFloat(n.toPrecision(15)));
}

// ─────────────────────────────────────────────────────────────────── API

/**
 * Lee un .xls y devuelve sus hojas con datos: `[{ name, rows }]`.
 * `rows` es denso hasta la última celda con contenido (R5) y las hojas vacías se omiten (R6).
 */
// El stream del libro, ya descifrado si venía marcado «solo lectura recomendada».
function openWorkbook(buf) {
  const { read } = readCompound(buf);
  // "Workbook" es BIFF8; "Book" es el nombre que usaba BIFF5
  const stream = read('Workbook') ?? read('Book');
  if (!stream) throw new Error(t('docXlsNoWorkbook'));

  const filepass = records(stream).find((r) => r.id === RECORD.FILEPASS);
  if (!filepass) return stream;
  const d = filepass.data;
  // solo RC4 estándar (tipo 1, 54 bytes); CryptoAPI y ECMA-376 quedan fuera de alcance
  if (d.length < 54 || d.readUInt16LE(0) !== 1) throw new Error(t('docXlsEncrypted'));
  const salt = d.subarray(6, 22);
  if (!verifyPassword(DEFAULT_PASSWORD, salt, d.subarray(22, 38), d.subarray(38, 54))) throw new Error(t('docXlsEncrypted'));
  return decryptStream(stream, DEFAULT_PASSWORD, salt);
}

// Las hojas (nombre y posición de su substream) y la tabla de cadenas compartidas.
function sheetIndex(recs) {
  const sheets = [];
  let sst = null;
  for (let i = 0; i < recs.length; i++) {
    if (recs[i].id === RECORD.SST && !sst) sst = parseSST(recs, i);
    if (recs[i].id === RECORD.BOUNDSHEET) sheets.push({ name: shortString(recs[i].data, 6), pos: recs[i].data.readUInt32LE(0) });
  }
  return { sheets, sst: sst ?? [] };
}

// Valor de una FORMULA: su resultado en caché. Los 2 últimos bytes del double a 0xFFFF marcan
// texto (en el registro STRING siguiente), booleano o error.
function formulaValue(d, next) {
  if (d.readUInt16LE(12) !== 0xffff) return numToText(d.readDoubleLE(6));
  const kind = d.readUInt8(6);
  if (kind === 0) return next && next.id === RECORD.STRING ? longString(next.data, 0) : null;
  return kind === 1 ? (d.readUInt8(8) ? 'TRUE' : 'FALSE') : null;
}

// Las celdas que trae un registro: [[fila, columna, valor], …]. Uno sin valor de celda da [] y se
// ignora, nunca aborta.
function cellsOf(r, next, sst) {
  const d = r.data;
  const at = (value) => [[d.readUInt16LE(0), d.readUInt16LE(2), value]];
  switch (r.id) {
    case RECORD.LABELSST: return at(sst[d.readUInt32LE(6)] ?? '');
    case RECORD.LABEL: return at(longString(d, 6));
    case RECORD.NUMBER: return at(numToText(d.readDoubleLE(6)));
    case RECORD.RK: return at(numToText(rkNum(d.readInt32LE(6))));
    case RECORD.BOOLERR: return d.readUInt8(7) === 0 ? at(d.readUInt8(6) ? 'TRUE' : 'FALSE') : [];
    case RECORD.FORMULA: return at(formulaValue(d, next));
    case RECORD.MULRK: {
      // una fila, varias columnas seguidas; los 2 últimos bytes son la columna final
      const out = [];
      for (let p = 4, col = d.readUInt16LE(2); p + 6 <= d.length - 2; p += 6) out.push([d.readUInt16LE(0), col++, numToText(rkNum(d.readInt32LE(p + 2)))]);
      return out;
    }
    default: return [];
  }
}

// Las celdas con texto de una hoja, por fila: { byRow: Map<fila, valores[]>, maxRow }.
function readSheet(recs, start, sst) {
  const byRow = new Map();
  let maxRow = -1;
  for (let i = start + 1; i < recs.length && recs[i].id !== RECORD.EOF; i++) {
    for (const [row, col, value] of cellsOf(recs[i], recs[i + 1], sst)) {
      const text = value == null ? '' : String(value).trim();
      if (!text || col >= MAX_XLS_COLS) continue;   // BIFF8 tiene 256 columnas: más allá es un archivo corrupto
      if (!byRow.has(row)) byRow.set(row, []);
      byRow.get(row)[col] = text;
      if (row > maxRow) maxRow = row;
    }
  }
  return { byRow, maxRow };
}

// Filas densas a partir de las dispersas. Cada fila se rellena solo hasta SU última columna con dato:
// recorrer el rectángulo maxRow × maxCol eran hasta 65535 × 65535 iteraciones para dos celdas.
// `budget.used` cuenta lo materializado en todo el libro, con su tope.
function denseRows({ byRow, maxRow }, budget) {
  const rows = [];
  for (let r = 0; r <= maxRow; r++) {
    const sparse = byRow.get(r) || [];
    budget.used += sparse.length + 1;
    if (budget.used > MAX_XLS_CELLS) throw new Error(t('docTooLarge'));
    const line = Array.from(sparse, (v) => v ?? '');
    while (line.length && line.at(-1) === '') line.pop(); // se recorta la cola, no los huecos
    rows.push(line);
  }
  while (rows.length && rows.at(-1).length === 0) rows.pop();
  return rows;
}

export function xlsToSheets(buf) {
  const recs = records(openWorkbook(buf));
  const { sheets, sst } = sheetIndex(recs);
  const budget = { used: 0 };
  const out = [];
  for (const sheet of sheets) {
    const start = recs.findIndex((r) => r.pos === sheet.pos);
    if (start < 0) continue;
    const cells = readSheet(recs, start, sst);
    if (cells.byRow.size) out.push({ name: sheet.name, rows: denseRows(cells, budget) });
  }
  return out;
}

export const _internals = { rc4, rc4Apply, deriveKey, verifyPassword, decryptStream, records, parseSST, rkNum, numToText };
