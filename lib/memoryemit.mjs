// lib/memoryemit.mjs — emisión de la memoria dentro de un repo equipado (spec 015, R21).
// Responsabilidad ÚNICA: decir QUÉ se emite de la memoria. Razón de cambio: qué archivos la componen.
// La mecánica de copiar vive en `emittree.mjs`.
//
// Se copia el CÓDIGO; los DATOS del repo —`memory.jsonl`, los conceptos aprendidos, el punto de la
// última captura— no están en el catálogo, así que equipar de nuevo nunca los pisa.
//
// Invariante: todo lo emitido cuelga de `.chalc/` y solo importa builtins de node o rutas relativas
// dentro de esa carpeta — corre con `node .chalc/memory.mjs` aunque chalc no esté instalado.

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emitTree, launcherFor } from './emittree.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const MEMORY_DIR = join(ROOT, 'catalog', 'memory');   // origen por defecto de la memoria
export const MEMORY_ENTRY_REL = '.chalc/memory.mjs';         // entrada, tal como se invoca desde el repo

// Emite la memoria en `projectPath`. `sourceDir` es inyectable para poder probar la copia sin depender
// de su contenido. Devuelve { written }.
export async function emitMemory(projectPath, { sourceDir = MEMORY_DIR } = {}) {
  const written = await emitTree(projectPath, {
    sourceDir,
    subdir: 'memory',
    launcherRel: MEMORY_ENTRY_REL,
    launcher: launcherFor('memory', 'memory.mjs', 'Memoria del proyecto: busca lo aprendido y lo captura al cerrar cada tarea.')
  });

  return { written };
}
