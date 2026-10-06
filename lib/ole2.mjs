// lib/ole2.mjs — contenedor OLE2/CFB (Compound File Binary) en Node puro.
//
// Es el envoltorio de los formatos binarios de Office antiguos (.xls, .doc, .ppt): un
// mini sistema de ficheros con FAT dentro de un solo archivo. Este módulo NO sabe nada de
// Excel: abre el contenedor y entrega streams por nombre. Lo que haya dentro es cosa del que llama.
//
// Referencia: [MS-CFB]. Para la familia ZIP (docx/xlsx/odt) el equivalente vive en docread.mjs.

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
export function readCompound(buf) {
  if (!isCompound(buf)) throw new Error('OLE2: firma no reconocida');

  const secSize = 1 << buf.readUInt16LE(30);
  const miniSize = 1 << buf.readUInt16LE(32);
  const cutoff = buf.readUInt32LE(56);
  const at = (sector) => (sector + 1) * secSize; // el sector 0 empieza tras la cabecera

  // ── DIFAT: los 109 punteros de la cabecera, más los sectores extra si el archivo es grande
  const difat = [];
  for (let i = 0; i < 109; i++) {
    const s = buf.readUInt32LE(76 + i * 4);
    if (s < FREE) difat.push(s);
  }
  let extra = buf.readUInt32LE(68);
  const extraCount = buf.readUInt32LE(72);
  for (let k = 0; k < extraCount && extra < FREE; k++) {
    const base = at(extra);
    if (base + secSize > buf.length) break;
    const perSector = secSize / 4 - 1; // la última ranura encadena al siguiente sector DIFAT
    for (let i = 0; i < perSector; i++) {
      const s = buf.readUInt32LE(base + i * 4);
      if (s < FREE) difat.push(s);
    }
    extra = buf.readUInt32LE(base + perSector * 4);
  }

  // ── FAT: la tabla "siguiente sector" completa
  const fat = [];
  for (const s of difat) {
    const base = at(s);
    if (base + secSize > buf.length) break;
    for (let i = 0; i < secSize / 4; i++) fat.push(buf.readUInt32LE(base + i * 4));
  }

  const chain = (start, table) => {
    const out = [];
    let s = start;
    while (s < FREE && out.length < MAX_CHAIN) {
      out.push(s);
      s = table[s];
      if (s === undefined) break;
    }
    return out;
  };
  const readFat = (start, size) => {
    const parts = chain(start, fat).map((s) => buf.subarray(at(s), at(s) + secSize));
    return Buffer.concat(parts).subarray(0, size);
  };

  // ── directorio: entradas de 128 bytes con nombre UTF-16 y sector inicial
  const dirStart = buf.readUInt32LE(48);
  const dirBuf = readFat(dirStart, chain(dirStart, fat).length * secSize);
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

  // ── mini-stream: los streams por debajo del umbral viven empaquetados dentro de la raíz
  const root = entries.find((e) => e.type === 5);
  const miniFatStart = buf.readUInt32LE(60);
  const miniFat = [];
  if (miniFatStart < FREE) {
    const raw = readFat(miniFatStart, chain(miniFatStart, fat).length * secSize);
    for (let i = 0; i + 4 <= raw.length; i += 4) miniFat.push(raw.readUInt32LE(i));
  }
  const miniStream = root && root.size ? readFat(root.start, root.size) : Buffer.alloc(0);

  const read = (name) => {
    const e = entries.find((x) => x.name === name && x.type === 2);
    if (!e) return null;
    if (e.size < cutoff && miniStream.length) {
      const parts = chain(e.start, miniFat).map((s) => miniStream.subarray(s * miniSize, (s + 1) * miniSize));
      return Buffer.concat(parts).subarray(0, e.size);
    }
    return readFat(e.start, e.size);
  };

  return { entries, read };
}
