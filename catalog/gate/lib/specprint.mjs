// specprint.mjs — huellas de la spec (spec 024, R8, R10). Responsabilidad ÚNICA: reducir a un hash el
// texto de la HU y el conjunto HU+spec+plan+tareas. Razón de cambio: qué cuenta como «el mismo contenido».
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// La huella ata la revisión del analista y la aprobación del usuario a un contenido concreto. Marcar
// casillas de `tasks.md` es avanzar, no cambiar la spec: no la altera. Editar cualquier texto, sí.

import { createHash } from 'node:crypto';

const ORDER = ['hu.md', 'spec.md', 'plan.md', 'tasks.md'];
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
// El mismo archivo en un checkout de Windows (CRLF) es el mismo contenido.
const normalized = (text) => String(text ?? '').replace(/\r\n/g, '\n');
const unticked = (tasks) => tasks.replace(/^(\s*- )\[[xX]\]/gm, '$1[ ]');

// Un JSON en su forma canónica; si no se puede leer, su texto tal cual; vacío si no hay nada.
function canonicalJson(text) {
  const raw = normalized(text).trim();
  try { return raw ? JSON.stringify(JSON.parse(raw)) : ''; } catch { return raw; }
}

/** sha256 (64 hex) del texto de la HU. */
export const huHash = (text) => sha256(normalized(text));

/** Huella de 16 hex de `{ 'hu.md', 'spec.md', 'plan.md', 'tasks.md' }`; un archivo ausente cuenta vacío. */
export function specFingerprint(files) {
  const parts = ORDER.map((name) => (name === 'tasks.md' ? unticked(normalized(files[name])) : normalized(files[name])));
  // El diseño, cuando existe, también es lo que el usuario aprueba (spec 038, R7). Sin él la huella es la de siempre.
  const design = normalized(files['design.md']);
  // Y las sondas (spec 041, R6): por su contenido, no por cómo esté formateado el JSON.
  const probes = canonicalJson(files['probes.json']);
  return sha256(parts.join('\0') + (design.trim() ? `\0design\0${design}` : '') + (probes ? `\0probes\0${probes}` : '')).slice(0, 16);
}
