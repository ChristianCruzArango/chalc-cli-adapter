// lib/emittree.mjs — copiar un árbol de código de chalc dentro de `.chalc/` (specs 007, 008, 010).
// Responsabilidad ÚNICA: la mecánica de emisión. Razón de cambio: cómo se copia y dónde aterriza.
//
// Los tres emisores —portón, advisor y buzón— hacían exactamente lo mismo con distinto origen y
// distinto lanzador. La etapa de duplicación de la spec 012 lo detectó en su primera corrida sobre
// este repo: catorce líneas idénticas entre `gateemit.mjs`, `nextemit.mjs` y `mailemit.mjs`, escritas
// copiando la primera. La herramienta se cazó a sí misma.
//
// Lo que cada emisor conserva es lo que de verdad le distingue: qué copia, cómo se llama su
// lanzador, y —solo el portón— la fusión de su configuración.

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

// Archivos de `dir`, en rutas relativas con '/'.
async function filesOf(dir, rel = '') {
  const found = [];
  for (const entry of await readdir(join(dir, rel), { withFileTypes: true })) {
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...await filesOf(dir, child));
    else found.push(child);
  }
  return found;
}

// Copia un archivo dentro de `.chalc/` y devuelve su ruta relativa al proyecto (para el informe).
async function copyInto(projectPath, from, relInChalc) {
  const dest = join(projectPath, '.chalc', relInChalc);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, await readFile(from));
  return `.chalc/${relInChalc}`;
}

// Copia `sourceDir` bajo `.chalc/<subdir>/` y escribe el lanzador en `launcherRel`.
//
// El árbol se copia TAL CUAL, así las rutas relativas entre sus módulos —y hacia los árboles vecinos,
// un nivel al lado— son las mismas en el catálogo y en el repo destino. El código SIEMPRE se
// regenera: es artefacto de chalc, no superficie de configuración.
//
// Devuelve las rutas escritas, relativas al proyecto.
export async function emitTree(projectPath, { sourceDir, subdir, launcherRel, launcher }) {
  const written = [];

  for (const rel of await filesOf(sourceDir)) {
    written.push(await copyInto(projectPath, join(sourceDir, rel), `${subdir}/${rel}`));
  }

  await writeFile(join(projectPath, launcherRel), launcher, 'utf8');
  written.push(launcherRel);

  return written;
}

// El lanzador de una línea que el humano invoca. El archivo real vive un nivel adentro: moverlo
// aquí le rompería sus propios imports relativos.
export const launcherFor = (subdir, entry, description) => [
  '// Generado por chalc — no edites este archivo: se regenera al equipar el repo.',
  `// ${description}`,
  `import './${subdir}/${entry}';`,
  ''
].join('\n');
