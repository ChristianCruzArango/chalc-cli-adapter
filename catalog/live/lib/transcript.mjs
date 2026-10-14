// transcript.mjs — leer lo nuevo de un transcript (spec 020, R12). Responsabilidad ÚNICA: devolver las líneas
// COMPLETAS que hay después de un cursor, y dónde queda el cursor. Razón de cambio: cómo crece un transcript.
//
// Este archivo lo emite chalc dentro de `.chalc/live/lib/`. No edites aquí: se regenera al equipar.
//
// Un transcript de una sesión larga pesa megas y el hook corre en cada herramienta: leerlo entero cada vez
// sería caro. Se lee solo desde el cursor y hasta el último salto de línea —una línea a medio escribir se
// lee en el evento siguiente, entera—. El cursor va en bytes, así que un carácter de varios bytes nunca se
// parte. Si el archivo encogió, es otro en su lugar: se lee desde el principio.

import { open } from 'node:fs/promises';

const NEWLINE = 0x0a;

/** Lo nuevo de `path` desde `offset`: `{ text, offset }`. Un archivo que no existe es `{ text: '', offset: 0 }`. */
export async function readNew(path, offset) {
  let file;
  try { file = await open(path, 'r'); } catch { return { text: '', offset: 0 }; }
  try {
    const { size } = await file.stat();
    const from = offset > 0 && offset <= size ? offset : 0;
    const bytes = Buffer.alloc(size - from);
    await file.read(bytes, 0, bytes.length, from);
    const end = bytes.lastIndexOf(NEWLINE) + 1;
    return { text: bytes.subarray(0, end).toString('utf8'), offset: from + end };
  } finally {
    await file.close();
  }
}
