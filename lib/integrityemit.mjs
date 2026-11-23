// lib/integrityemit.mjs — el manifiesto de integridad de un repo equipado (spec 029, R7). Responsabilidad
// ÚNICA: escribir `.chalc/integrity.json` con la huella de lo que se acaba de emitir. Razón de cambio: qué
// archivos son «herramienta». El cálculo vive en el propio portón (`catalog/gate/lib/integrity.mjs`), que es
// quien lo comprueba después: una sola forma de calcular la huella.

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CONFIG_REL } from '../catalog/gate/lib/config.mjs';
import { INTEGRITY_REL, manifestOf } from '../catalog/gate/lib/integrity.mjs';

// La configuración es del usuario: la edita a propósito, y sus cambios los vigila el sello de comandos.
const NOT_TOOLING = new Set([CONFIG_REL]);

/** Escribe el manifiesto de los archivos `written` (rutas relativas a `projectPath`). Devuelve su ruta relativa. */
export async function emitIntegrity(projectPath, written) {
  const tools = written.filter((rel) => !NOT_TOOLING.has(rel));
  const manifest = await manifestOf(projectPath, tools);
  await writeFile(join(projectPath, ...INTEGRITY_REL.split('/')), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  return INTEGRITY_REL;
}
