// integrity.mjs — la integridad de las herramientas de chalc en el repo (spec 029, R7, R8). Responsabilidad
// ÚNICA: calcular la huella de cada herramienta y decir cuáles ya no coinciden con su manifiesto. Razón de
// cambio: qué cuenta como «la misma herramienta».
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// Quien es medido por el portón puede editarlo. El manifiesto no lo impide —vive en el mismo repo—, pero hace
// que el cambio se note: el portón se niega a medir, el diff lo muestra y CI lo repite fuera de la máquina.

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const INTEGRITY_REL = '.chalc/integrity.json';
// La entrada del portón: si existe, este repo tiene herramientas emitidas que deben llevar manifiesto.
const GATE_ENTRY_REL = '.chalc/gate/gate.mjs';

const at = (root, rel) => join(root, ...rel.split('/'));

/** sha256 del contenido, sin depender del fin de línea (un checkout en Windows no es una alteración). */
export const digestOf = (content) => createHash('sha256').update(String(content).replace(/\r\n/g, '\n')).digest('hex');

/** El manifiesto `{ files: { ruta: huella } }` de los archivos `files` (rutas relativas a `root`), ordenado. */
export async function manifestOf(root, files) {
  const entries = [];
  for (const rel of [...new Set(files)].sort()) entries.push([rel, digestOf(await readFile(at(root, rel)))]);
  return { files: Object.fromEntries(entries) };
}

// El manifiesto escrito al equipar, o null si falta o no se puede leer.
async function readManifest(root) {
  try {
    const manifest = JSON.parse(await readFile(at(root, INTEGRITY_REL), 'utf8'));
    return manifest && typeof manifest.files === 'object' && manifest.files ? manifest : null;
  } catch { return null; }
}

// El estado de UNA herramienta frente a su huella: '' si coincide.
async function stateOf(root, rel, expected) {
  let content;
  try { content = await readFile(at(root, rel)); } catch { return 'missing'; }
  return digestOf(content) === expected ? '' : 'altered';
}

/**
 * Las herramientas de `root` que no coinciden con su manifiesto: [{ file, reason }], con `reason`
 * `altered`, `missing` o `no-manifest`. Un repo sin herramientas emitidas no tiene nada que comprobar.
 */
export async function integrityProblems(root) {
  const manifest = await readManifest(root);
  if (!manifest) return existsSync(at(root, GATE_ENTRY_REL)) ? [{ file: INTEGRITY_REL, reason: 'no-manifest' }] : [];
  const problems = [];
  for (const [file, expected] of Object.entries(manifest.files)) {
    const reason = await stateOf(root, file, expected);
    if (reason) problems.push({ file, reason });
  }
  return problems;
}
