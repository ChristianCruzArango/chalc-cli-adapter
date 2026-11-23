// specset.mjs — los cuatro documentos de la carpeta activa (spec 024, R1, R2). Responsabilidad ÚNICA:
// leerlos juntos y de un solo sitio. Razón de cambio: qué archivos forman una spec.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// Por qué existe: `tasks.md` se buscaba en la carpeta más nueva QUE LO TUVIERA, así que una spec nueva
// sin tareas reutilizaba en silencio las de la feature anterior. Aquí lo que falta es `null`, nunca
// el archivo de otra carpeta.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { activeSpecDir } from './spec.mjs';

export const SPEC_FILES = Object.freeze(['hu.md', 'spec.md', 'plan.md', 'tasks.md']);

/** Lo que una spec PUEDE traer además: se lee y se sella con ella, pero no es obligatorio (spec 038). */
export const OPTIONAL_FILES = Object.freeze(['design.md', 'probes.json']);

const textOrNull = async (path) => { try { return await readFile(path, 'utf8'); } catch { return null; } };

/** { dir, problem, pinned, files: { 'hu.md': texto|null, … } } de la carpeta activa de `specDir`. */
export async function readSpecSet(root, specDir) {
  const active = await activeSpecDir(root, specDir);
  const files = {};
  for (const name of [...SPEC_FILES, ...OPTIONAL_FILES]) files[name] = active.dir ? await textOrNull(join(root, active.dir, name)) : null;
  return { ...active, files };
}
