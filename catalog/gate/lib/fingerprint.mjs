// fingerprint.mjs — la huella de lo que el portón revisó. Responsabilidad ÚNICA: resumir en un hash
// el CONTENIDO de los archivos del alcance, y comparar la config del portón con la sellada.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// Por qué: el estado que lee el advisor se fiaba de una fecha. Con una fecha futura, una evidencia
// valía para siempre; y editar el código después del portón solo se detectaba por el mtime. La huella
// ata la evidencia al contenido exacto que se revisó: un `commit` no la invalida, cambiar una línea sí.
//
// Límite, dicho claro: esto sube el listón, NO hace el portón inviolable. Quien puede escribir en el
// repo puede recalcular la huella; no hay secreto local que un agente con shell no pueda leer.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** sha256 de los archivos `files` (rutas relativas a `root`): nombre y contenido, en orden estable. */
export async function scopeHash(root, files = []) {
  const hash = createHash('sha256');
  for (const rel of [...new Set(files)].sort()) {
    let content;
    try { content = await readFile(join(root, rel)); } catch { content = null; }
    hash.update(`${rel}\0${content ? createHash('sha256').update(content).digest('hex') : 'missing'}\0`);
  }
  return hash.digest('hex');
}

// Las claves de `gate.json` que deciden si una tarea puede cerrarse. Cambiarlas no está prohibido
// —el usuario ajusta su portón—, pero la evidencia tiene que decirlo: con `mutation.required: false`
// o `test.command: "true"` el portón aprueba sin medir nada.
const GUARDED = [
  ['test', 'command'],
  ['mutation', 'command'], ['mutation', 'required'], ['mutation', 'threshold'], ['mutation', 'format'], ['mutation', 'report'],
  ['security', 'enabled'],
  ['lint'],
  ['flow', 'roles']
];

const at = (obj, path) => path.reduce((v, k) => (v && typeof v === 'object' ? v[k] : undefined), obj);

/** Lo que conviene guardar al sellar una tarea para poder comparar después. */
export const guardedConfig = (config = {}) => Object.fromEntries(GUARDED.map((p) => [p.join('.'), at(config, p) ?? null]));

/** Claves vigiladas cuyo valor cambió respecto a lo sellado. Sin sellado, no hay con qué comparar. */
export function configChanges(sealed, config = {}) {
  if (!sealed || typeof sealed !== 'object') return [];
  const now = guardedConfig(config);
  return Object.keys(now).filter((key) => key in sealed && JSON.stringify(sealed[key]) !== JSON.stringify(now[key]));
}
