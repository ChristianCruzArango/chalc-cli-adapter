// spec.mjs — la spec vigente del repo. Responsabilidad ÚNICA: decir cuál de las carpetas de
// `specs/` es la que se está implementando. Razón de cambio: cómo se organizan las specs.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// La vigente es la de número más alto: el flujo de chalc crea la carpeta y sobre esa se trabaja.

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const NUMBERED = /^(\d+)-/;

// Todas las carpetas de spec que contienen `requires`, de la más reciente a la más antigua, con el
// contenido de ese archivo. Devuelve [{ dir, path, text }].
//
// Existe porque no todo se resuelve contra la spec vigente. Lo que se implementa hoy sale de ella,
// pero un test cambiado puede cubrir legítimamente un requisito de una spec anterior; sin poder
// mirarlas todas, esa cita correcta se reporta como inventada.
export async function everySpec(root, specDir, requires) {
  let entries;
  try { entries = await readdir(join(root, specDir), { withFileTypes: true }); } catch { return []; }

  const numbered = entries
    .filter((e) => e.isDirectory() && NUMBERED.test(e.name))
    .sort((a, b) => Number(NUMBERED.exec(b.name)[1]) - Number(NUMBERED.exec(a.name)[1]));

  const found = [];
  for (const entry of numbered) {
    const path = `${specDir}/${entry.name}/${requires}`;
    try {
      found.push({ dir: `${specDir}/${entry.name}`, path, text: await readFile(join(root, path), 'utf8') });
    } catch { /* esta carpeta no tiene ese archivo: se prueba la siguiente */ }
  }
  return found;
}

// Carpeta de spec más reciente que contiene `requires`, con el contenido de ese archivo.
// Devuelve { dir, path, text } o null. Una carpeta sin el archivo pedido no descarta a las demás:
// se sigue bajando por número hasta encontrar una que lo tenga.
export async function newestSpec(root, specDir, requires) {
  return (await everySpec(root, specDir, requires))[0] || null;
}
