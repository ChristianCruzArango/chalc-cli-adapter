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

// Lo más que se lee de una vez. La primera vista de un transcript (sin cursor) o uno que creció de golpe podía
// pesar cientos de megas, y se reservaba entero en un hook `PreToolUse`: se lee solo su cola, desde el
// principio de una línea. Lo que queda antes no se cuenta, que es mejor que hacer esperar al turno.
export const MAX_READ_BYTES = 4 * 1024 * 1024;

/** Lo nuevo de `path` desde `offset`: `{ text, offset }`. Un archivo que no existe es `{ text: '', offset: 0 }`. */
export async function readNew(path, offset, { maxBytes = MAX_READ_BYTES } = {}) {
  let file;
  try { file = await open(path, 'r'); } catch { return { text: '', offset: 0 }; }
  try {
    const { size } = await file.stat();
    // Stryker disable next-line EqualityOperator: equivalente — con `offset` 0 las dos ramas dan 0
    const wanted = offset > 0 && offset <= size ? offset : 0;
    const skips = size - wanted > maxBytes;
    const from = skips ? size - maxBytes : wanted;
    const bytes = Buffer.alloc(size - from);
    await file.read(bytes, 0, bytes.length, from);
    // Tras saltar se empieza en la línea siguiente: la cortada a la mitad no es JSON. Sin ninguna línea
    // entera en la cola, no hay nada que leer todavía.
    const cut = skips ? bytes.indexOf(NEWLINE) : -1;
    if (skips && cut < 0) return { text: '', offset: wanted };
    const end = bytes.lastIndexOf(NEWLINE) + 1;
    return { text: bytes.subarray(cut + 1, end).toString('utf8'), offset: from + end };
  } finally {
    await file.close();
  }
}
