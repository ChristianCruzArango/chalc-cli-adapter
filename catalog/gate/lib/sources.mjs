// sources.mjs — el árbol de fuentes del usuario (spec 012, R6, R8). Responsabilidad ÚNICA: decir
// qué archivos son código del repo. Razón de cambio: qué cuenta como fuente y qué se excluye.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// Esta lógica vivía privada dentro de `changed.mjs`, como respaldo para cuando no hay git. La etapa
// de duplicación necesita lo mismo, y escribir una segunda versión de «qué archivos son del usuario»
// dentro del detector de duplicación habría sido, además de irónico, una fuente garantizada de
// desincronización: `changed.mjs` ya aprendió a excluir `.chalc/` a base de un bug real.

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

// Extensiones que alguna etapa sabe revisar. Lo demás no entra.
export const SOURCE_FILE = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs|dart|cs|java|kt|py)$/;

export const SKIP_DIRS = new Set([
  '.git', '.chalc', 'node_modules', 'dist', 'build', 'out', 'target', 'obj', 'bin',
  '.next', '.nuxt', '.angular', '.dart_tool', '.gradle', '.venv', 'venv', 'coverage'
]);

// Todos los fuentes del proyecto, en rutas relativas con '/'.
//
// `max` acota el recorrido en repos enormes, y cuando se alcanza se DECLARA (R8): un recorte
// silencioso se lee como «revisé todo y no había nada», que es mentira. Es la misma regla que el
// portón ya aplica cuando no puede verificar algo.
//
// El tope se comprueba en un solo sitio, dentro del bucle. Había una segunda comprobación al entrar
// en cada carpeta; la pasada de mutación la señaló como equivalente —nunca llegaba a decidir nada—
// y se quitó en vez de inventarle un test.
export async function sourceFiles(root, { max = Infinity } = {}) {
  const files = [];
  let capped = false;

  async function walk(rel) {
    let entries;
    try { entries = await readdir(join(root, rel), { withFileTypes: true }); } catch { return; }

    for (const entry of entries) {
      if (files.length >= max) { capped = true; return; }
      const child = rel ? `${rel}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) await walk(child);
      } else if (SOURCE_FILE.test(entry.name)) {
        files.push(child);
      }
    }
  }

  await walk('');
  return { files: files.sort(), capped };
}
