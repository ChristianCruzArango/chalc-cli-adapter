// lib/skillsource/hashdir.mjs — huella del contenido de una skill. `chalc update` la compara para decidir
// si una skill cambió en su fuente, y el lock la registra.

import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { isRunnableTest } from './runnabletest.mjs';

// Versión del cálculo de `hashDir`. Se guarda en el manifiesto: un hash de otra versión no se compara
// con uno de esta (ver checkSkillUpdate).
export const HASH_VERSION = 2;

// Archivos que escribe chalc dentro de la skill: no son contenido de la fuente.
export const isChalcFile = (rel) => rel === '.chalc-skill.json' || rel === '.chalc-managed';

// Un archivo de texto se normaliza a LF: git lo reescribe con CRLF al hacer checkout en Windows.
export async function readNormalized(file) {
  const content = await readFile(file);
  return content.includes(0) ? content : Buffer.from(content.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
}

// Orden lexicográfico por nombre (por código, no por locale): igual en todos los SO.
export const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

// Recorre `dir` en orden lexicográfico fijo (readdir no garantiza orden) y entrega cada archivo con su
// ruta relativa en `/` (en Windows `relative` da `a\b`), saltando los archivos de chalc y los tests ejecutables,
// que no se vendorizan (spec 025, R19). `list` es
// inyectable para los tests: en APFS readdir ya devuelve ordenado y el orden propio no se vería.
export async function walkFiles(dir, onFile, { list = readdir } = {}) {
  const walk = async (base) => {
    const entries = (await list(base, { withFileTypes: true })).sort(byName);
    for (const e of entries) {
      const file = join(base, e.name);
      const rel = relative(dir, file).replace(/\\/g, '/');
      if (isChalcFile(rel)) continue;
      if (e.isDirectory()) await walk(file);
      else if (!isRunnableTest(rel)) await onFile(rel, file);
    }
  };
  await walk(dir);
}

// Igual en todos los SO (F-18): cada archivo se delimita con su nombre y su longitud (sin delimitador,
// `a`+`bc` y `ab`+`c` daban lo mismo).
export async function hashDir(dir) {
  const hash = createHash('sha256');
  await walkFiles(dir, async (rel, file) => {
    const content = await readNormalized(file);
    hash.update(`${rel}\0${content.length}\0`);
    hash.update(content);
  });
  return hash.digest('hex');
}
