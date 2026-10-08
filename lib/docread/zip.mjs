// lib/docread/zip.mjs — lectura de ZIP (OOXML/ODF) sin dependencias, con límites de descompresión.

import { inflateRawSync } from 'node:zlib';
import { t } from '../i18n.mjs';

// ---------------------------------------------------------------- ZIP (OOXML/ODF)

// El fin del directorio central (EOCD) está al final del ZIP, tras un comentario de hasta 64 KB:
// basta buscarlo en esa ventana (64 KB + su propia cabecera, con margen).
const EOCD_SEARCH_WINDOW = 66 * 1024;

function findEocd(buf) {
  const max = Math.min(buf.length, EOCD_SEARCH_WINDOW);
  for (let i = buf.length - 22; i >= buf.length - max && i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

/** Lista las entradas del directorio central de un ZIP. */
export function zipEntries(buf) {
  const eocd = findEocd(buf);
  if (eocd < 0) throw new Error(t('docNotZip'));
  let count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  // ZIP64: los campos de 32 bits vienen saturados y hay que leer el EOCD64.
  if (offset === 0xffffffff || count === 0xffff) {
    const loc = eocd - 20;
    if (loc >= 0 && buf.readUInt32LE(loc) === 0x07064b50) {
      const eocd64 = Number(buf.readBigUInt64LE(loc + 8));
      if (buf.readUInt32LE(eocd64) === 0x06064b50) {
        count = Number(buf.readBigUInt64LE(eocd64 + 32));
        offset = Number(buf.readBigUInt64LE(eocd64 + 48));
      }
    }
  }
  const entries = [];
  let p = offset;
  for (let i = 0; i < count && p + 46 <= buf.length; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.push({ name, method, compSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// Límites de lectura. Un documento de pocos KB puede declarar una fila 2.147.483.647 o inflarse a
// cientos de MB (bomba zip): sin tope, el proceso muere por falta de heap —un error fatal que ningún
// try/catch captura— antes de que el respaldo con LibreOffice llegue a intentarlo.
export const MAX_INFLATE = 64 * 1024 * 1024;   // por entrada ZIP o stream de PDF, descomprimido
export const MAX_PDF_TOTAL = 128 * 1024 * 1024;
export const MAX_ROWS = 1_048_576;              // límites reales de Excel
export const MAX_COLS = 16_384;
export const MAX_CELLS = 5_000_000;             // celdas materializadas (huecos incluidos) por libro

export const inflateLimited = (inflate, raw) => {
  try { return inflate(raw, { maxOutputLength: MAX_INFLATE }); }
  catch (e) { if (e?.code === 'ERR_BUFFER_TOO_LARGE' || e instanceof RangeError) throw new Error(t('docTooLarge')); throw e; }
};

/** Devuelve el contenido (utf8) de la primera entrada cuyo nombre coincide. */
export function zipRead(buf, matcher) {
  const entry = zipEntries(buf).find((e) => matcher(e.name.toLowerCase().replace(/^\/+/, '')));
  if (!entry) return null;
  const lo = entry.localOffset;
  if (buf.readUInt32LE(lo) !== 0x04034b50) throw new Error(t('docZipHeader'));
  const nameLen = buf.readUInt16LE(lo + 26);
  const extraLen = buf.readUInt16LE(lo + 28);
  const start = lo + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, start + entry.compSize);
  if (entry.method === 0) return raw.toString('utf8');
  if (entry.method === 8) return inflateLimited(inflateRawSync, raw).toString('utf8');
  throw new Error(t('docZipMethod', entry.method));
}
