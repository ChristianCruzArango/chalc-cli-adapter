// lib/ole2.mjs — contenedor OLE2/CFB (Compound File Binary) en Node puro.
//
// Es el envoltorio de los formatos binarios de Office antiguos (.xls, .doc, .ppt): un
// mini sistema de ficheros con FAT dentro de un solo archivo. Este módulo NO sabe nada de
// Excel: abre el contenedor y entrega streams por nombre. Lo que haya dentro es cosa del que llama.
//
// Referencia: [MS-CFB]. Para la familia ZIP (docx/xlsx/odt) el equivalente vive en docread.mjs.

import { t } from './i18n.mjs';
const SIGNATURE = [0xe011cfd0, 0xe11ab1a1]; // d0cf11e0 a1b11ae1 leído como dos u32 LE
const FREE = 0xfffffffa;                    // a partir de aquí: sectores especiales, no datos
const MAX_CHAIN = 1 << 20;                  // corta cadenas circulares de un archivo corrupto

/** ¿Empieza este buffer por la firma de un contenedor OLE2? */
export function isCompound(buf) {
  return buf.length >= 8 && buf.readUInt32LE(0) === SIGNATURE[0] && buf.readUInt32LE(4) === SIGNATURE[1];
}

/**
 * Abre el contenedor y devuelve sus entradas y un lector por nombre.
 *
 * @returns {{ entries: Array<{name:string,type:number,size:number}>, read: (name:string) => Buffer|null }}
 */
// La geometría del contenedor: tamaños de sector y de mini-sector, umbral del mini-stream y cómo se
// llega al inicio de un sector. [MS-CFB] solo admite sectores de 512 (v3) o 4096 bytes (v4) y
// mini-sectores de 64: otro valor es un archivo corrupto o fabricado, y aceptarlo dejaba que el
// atacante fijara el tamaño de todo.
function geometryOf(buf) {
  const secShift = buf.readUInt16LE(30);
  const miniShift = buf.readUInt16LE(32);
  if (secShift !== 9 && secShift !== 12) throw new Error(t('oleBadSector'));
  if (miniShift !== 6) throw new Error(t('oleBadMiniSector'));
  const secSize = 1 << secShift;
  return {
    secSize,
    miniSize: 1 << miniShift,
    cutoff: buf.readUInt32LE(56),
    // Ninguna cadena legítima tiene más sectores de los que caben en el archivo.
    maxSectors: Math.ceil(buf.length / secSize),
    at: (sector) => (sector + 1) * secSize   // el sector 0 empieza tras la cabecera
  };
}

// DIFAT: los 109 punteros de la cabecera, más los sectores extra si el archivo es grande.
function difatOf(buf, g) {
  const difat = [];
  for (let i = 0; i < 109; i++) {
    const s = buf.readUInt32LE(76 + i * 4);
    if (s < FREE) difat.push(s);
  }
  let extra = buf.readUInt32LE(68);
  const extraCount = Math.min(buf.readUInt32LE(72), g.maxSectors);
  const seen = new Set();
  const perSector = g.secSize / 4 - 1; // la última ranura encadena al siguiente sector DIFAT
  for (let k = 0; k < extraCount && extra < FREE; k++) {
    if (seen.has(extra)) throw new Error(t('oleDifatCycle'));
    seen.add(extra);
    const base = g.at(extra);
    if (base + g.secSize > buf.length) break;
    for (let i = 0; i < perSector; i++) {
      const s = buf.readUInt32LE(base + i * 4);
      if (s < FREE) difat.push(s);
    }
    extra = buf.readUInt32LE(base + perSector * 4);
  }
  return difat;
}

// FAT: la tabla "siguiente sector" completa.
function fatOf(buf, g, difat) {
  const fat = [];
  for (const s of difat) {
    const base = g.at(s);
    if (base + g.secSize > buf.length) break;
    for (let i = 0; i < g.secSize / 4; i++) fat.push(buf.readUInt32LE(base + i * 4));
  }
  return fat;
}

// Los sectores de una cadena. Una que vuelve a un sector ya visitado es circular: crecería hasta el
// tope reservando memoria por cada vuelta (824 MB con 512 B/sector). Se corta en cuanto se repite.
function chain(start, table) {
  const out = [];
  const seen = new Set();
  for (let s = start; s < FREE && out.length < Math.min(MAX_CHAIN, table.length);) {
    if (seen.has(s)) throw new Error(t('oleChainCycle'));
    seen.add(s);
    out.push(s);
    s = table[s];
    if (s === undefined) break;
  }
  return out;
}

// Directorio: entradas de 128 bytes con nombre UTF-16 y sector inicial.
function entriesOf(dirBuf) {
  const entries = [];
  for (let p = 0; p + 128 <= dirBuf.length; p += 128) {
    const nameLen = dirBuf.readUInt16LE(p + 64);
    if (!nameLen) continue;
    entries.push({
      // nameLen incluye el terminador nulo (2 bytes) que no forma parte del nombre
      name: dirBuf.toString('utf16le', p, p + Math.max(0, nameLen - 2)),
      type: dirBuf.readUInt8(p + 66),
      start: dirBuf.readUInt32LE(p + 116),
      size: Number(dirBuf.readBigUInt64LE(p + 120))
    });
  }
  return entries;
}

// Mini-stream: los streams por debajo del umbral viven empaquetados dentro de la raíz.
function miniOf(buf, { entries, fat, readFat, g }) {
  const root = entries.find((e) => e.type === 5);
  const miniFatStart = buf.readUInt32LE(60);
  const miniFat = [];
  if (miniFatStart < FREE) {
    const raw = readFat(miniFatStart, chain(miniFatStart, fat).length * g.secSize);
    for (let i = 0; i + 4 <= raw.length; i += 4) miniFat.push(raw.readUInt32LE(i));
  }
  return { miniFat, miniStream: root && root.size ? readFat(root.start, root.size) : Buffer.alloc(0) };
}

export function readCompound(buf) {
  if (!isCompound(buf)) throw new Error(t('oleBadSignature'));
  const g = geometryOf(buf);
  const fat = fatOf(buf, g, difatOf(buf, g));
  const readFat = (start, size) => Buffer.concat(chain(start, fat).map((s) => buf.subarray(g.at(s), g.at(s) + g.secSize))).subarray(0, size);

  const dirStart = buf.readUInt32LE(48);
  const entries = entriesOf(readFat(dirStart, chain(dirStart, fat).length * g.secSize));
  const { miniFat, miniStream } = miniOf(buf, { entries, fat, readFat, g });

  const read = (name) => {
    const e = entries.find((x) => x.name === name && x.type === 2);
    if (!e) return null;
    if (e.size >= g.cutoff || !miniStream.length) return readFat(e.start, e.size);
    const parts = chain(e.start, miniFat).map((s) => miniStream.subarray(s * g.miniSize, (s + 1) * g.miniSize));
    return Buffer.concat(parts).subarray(0, e.size);
  };
  return { entries, read };
}
