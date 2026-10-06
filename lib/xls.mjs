// lib/xls.mjs — libros Excel binarios (.xls, BIFF8) a filas de texto, sin dependencias.
//
// Un .xls es un contenedor OLE2 (lib/ole2.mjs) con un stream "Workbook" dentro, y ese stream es
// una tira de registros [id:2][len:2][datos]. Aquí solo se leen los registros que llevan valor de
// celda; cualquier otro se ignora sin romper, que es lo que permite abrir libros reales.
//
// Los formularios institucionales suelen venir marcados "solo lectura recomendada", lo que en
// BIFF8 significa cifrado RC4 con una contraseña que Excel escribe sola y publica la
// especificación ([MS-OFFCRYPTO]). No es una protección: es un flag. Ver DEFAULT_PASSWORD.

import { createHash } from 'node:crypto';
import { readCompound } from './ole2.mjs';
import { t } from './i18n.mjs';

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

const RC4_BLOCK = 1024; // el keystream se reinicia cada bloque de 1024 bytes del stream

// ─────────────────────────────────────────────────────────────────── cifrado RC4

const md5 = (...parts) => createHash('md5').update(Buffer.concat(parts)).digest();

/**
 * RC4 como generador de keystream. A mano y no con node:crypto porque OpenSSL 3 saca RC4 del
 * proveedor por defecto: `createCipheriv('rc4')` revienta en buena parte de las instalaciones.
 */
function rc4(key) {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
  }
  let i = 0;
  let j = 0;
  return () => {
    i = (i + 1) & 255;
    j = (j + s[i]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
    return s[(s[i] + s[j]) & 255];
  };
}

/** RC4 de una sola tacada sobre un buffer (para el verificador, que son 32 bytes). */
function rc4Apply(key, data) {
  const next = rc4(key);
  const out = Buffer.alloc(data.length);
  for (let n = 0; n < data.length; n++) out[n] = data[n] ^ next();
  return out;
}

/** Derivación de clave RC4 de Office ([MS-OFFCRYPTO] 2.3.6.2). */
function deriveKey(password, salt, block) {
  const truncated = md5(Buffer.from(password.slice(0, 16), 'utf16le')).subarray(0, 5);
  // el bloque intermedio es (hash truncado + salt) repetido 16 veces
  const intermediate = Buffer.concat(Array.from({ length: 16 }, () => Buffer.concat([truncated, salt])));
  const final = md5(intermediate).subarray(0, 5);
  const blockLE = Buffer.alloc(4);
  blockLE.writeUInt32LE(block >>> 0, 0);
  return md5(final, blockLE).subarray(0, 16);
}

/** El verificador: descifra 32 bytes y comprueba que el MD5 de la primera mitad da la segunda. */
function verifyPassword(password, salt, encVerifier, encVerifierHash) {
  const clear = rc4Apply(deriveKey(password, salt, 0), Buffer.concat([encVerifier, encVerifierHash]));
  return md5(clear.subarray(0, 16)).equals(clear.subarray(16, 32));
}

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
function parseSST(recs, index) {
  const strings = [];
  const unique = recs[index].data.readUInt32LE(4);
  let buf = recs[index].data;
  let p = 8;
  let j = index;
  const nextChunk = () => {
    if (j + 1 >= recs.length || recs[j + 1].id !== RECORD.CONTINUE) return false;
    j += 1;
    buf = recs[j].data;
    p = 0;
    return true;
  };

  while (strings.length < unique) {
    if (p + 3 > buf.length && !nextChunk()) break;
    const cch = buf.readUInt16LE(p);
    p += 2;
    const flags = buf.readUInt8(p);
    p += 1;
    let wide = flags & 1;
    let runs = 0;
    let extLen = 0;
    if ((flags >> 3) & 1) { runs = buf.readUInt16LE(p); p += 2; }   // texto enriquecido
    if ((flags >> 2) & 1) { extLen = buf.readUInt32LE(p); p += 4; } // extensión asiática

    let text = '';
    let left = cch;
    while (left > 0) {
      const width = wide ? 2 : 1;
      const available = buf.length - p;
      const take = available > 0 ? Math.min(left, Math.floor(available / width)) : 0;
      if (take <= 0) {
        if (!nextChunk()) { left = 0; break; }
        wide = buf.readUInt8(p) & 1; // el trozo nuevo reanuncia el ancho
        p += 1;
        continue;
      }
      text += wide ? buf.toString('utf16le', p, p + take * 2) : buf.subarray(p, p + take).toString('latin1');
      p += take * width;
      left -= take;
    }
    p += runs * 4 + extLen;
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
export function xlsToSheets(buf) {
  const { read } = readCompound(buf);
  // "Workbook" es BIFF8; "Book" es el nombre que usaba BIFF5
  let stream = read('Workbook') ?? read('Book');
  if (!stream) throw new Error(t('docXlsNoWorkbook'));

  const filepass = records(stream).find((r) => r.id === RECORD.FILEPASS);
  if (filepass) {
    const d = filepass.data;
    // solo RC4 estándar (tipo 1, 54 bytes); CryptoAPI y ECMA-376 quedan fuera de alcance
    if (d.length < 54 || d.readUInt16LE(0) !== 1) throw new Error(t('docXlsEncrypted'));
    const salt = d.subarray(6, 22);
    if (!verifyPassword(DEFAULT_PASSWORD, salt, d.subarray(22, 38), d.subarray(38, 54))) {
      throw new Error(t('docXlsEncrypted'));
    }
    stream = decryptStream(stream, DEFAULT_PASSWORD, salt);
  }

  const recs = records(stream);
  const sheets = [];
  for (let i = 0; i < recs.length; i++) {
    if (recs[i].id === RECORD.SST && !sheets.sst) sheets.sst = parseSST(recs, i);
    if (recs[i].id === RECORD.BOUNDSHEET) {
      sheets.push({ name: shortString(recs[i].data, 6), pos: recs[i].data.readUInt32LE(0) });
    }
  }
  const sst = sheets.sst ?? [];

  const out = [];
  for (const sheet of sheets) {
    const start = recs.findIndex((r) => r.pos === sheet.pos);
    if (start < 0) continue;

    const cells = new Map();
    let maxRow = -1;
    let maxCol = -1;
    const put = (row, col, value) => {
      const text = value == null ? '' : String(value).trim();
      if (!text) return;
      cells.set(row + ',' + col, text);
      if (row > maxRow) maxRow = row;
      if (col > maxCol) maxCol = col;
    };

    for (let i = start + 1; i < recs.length; i++) {
      const r = recs[i];
      if (r.id === RECORD.EOF) break;
      const d = r.data;
      switch (r.id) {
        case RECORD.LABELSST:
          put(d.readUInt16LE(0), d.readUInt16LE(2), sst[d.readUInt32LE(6)] ?? '');
          break;
        case RECORD.LABEL:
          put(d.readUInt16LE(0), d.readUInt16LE(2), longString(d, 6));
          break;
        case RECORD.NUMBER:
          put(d.readUInt16LE(0), d.readUInt16LE(2), numToText(d.readDoubleLE(6)));
          break;
        case RECORD.RK:
          put(d.readUInt16LE(0), d.readUInt16LE(2), numToText(rkNum(d.readInt32LE(6))));
          break;
        case RECORD.MULRK: {
          // una fila, varias columnas seguidas; los 2 últimos bytes son la columna final
          const row = d.readUInt16LE(0);
          let col = d.readUInt16LE(2);
          for (let p = 4; p + 6 <= d.length - 2; p += 6) put(row, col++, numToText(rkNum(d.readInt32LE(p + 2))));
          break;
        }
        case RECORD.BOOLERR:
          if (d.readUInt8(7) === 0) put(d.readUInt16LE(0), d.readUInt16LE(2), d.readUInt8(6) ? 'TRUE' : 'FALSE');
          break;
        case RECORD.FORMULA: {
          const row = d.readUInt16LE(0);
          const col = d.readUInt16LE(2);
          // resultado especial: los 2 últimos bytes del double a 0xFFFF marcan texto/booleano/error
          if (d.readUInt16LE(12) === 0xffff) {
            const kind = d.readUInt8(6);
            if (kind === 0) {
              const next = recs[i + 1];
              if (next && next.id === RECORD.STRING) put(row, col, longString(next.data, 0));
            } else if (kind === 1) {
              put(row, col, d.readUInt8(8) ? 'TRUE' : 'FALSE');
            }
          } else {
            put(row, col, numToText(d.readDoubleLE(6)));
          }
          break;
        }
        default:
          break; // registro sin valor de celda: se ignora, nunca aborta
      }
    }

    if (!cells.size) continue;
    const rows = [];
    for (let r = 0; r <= maxRow; r++) {
      const line = [];
      for (let c = 0; c <= maxCol; c++) line.push(cells.get(r + ',' + c) ?? '');
      while (line.length && line.at(-1) === '') line.pop(); // se recorta la cola, no los huecos
      rows.push(line);
    }
    while (rows.length && rows.at(-1).length === 0) rows.pop();
    out.push({ name: sheet.name, rows });
  }
  return out;
}

export const _internals = { rc4, rc4Apply, deriveKey, verifyPassword, decryptStream, records, parseSST, rkNum, numToText };
