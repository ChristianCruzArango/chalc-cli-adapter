// lib/manifest.mjs — lo que un proyecto ya eligió, leído de su `.chalc.json` (spec 018, R7, R8).
// Responsabilidad ÚNICA: leer el manifiesto y traducirlo a valores por defecto para re-equipar. Razón de
// cambio: qué elecciones se recuerdan. Quien lo escribe es `targetkit.mjs` (`writeManifest`).
//
// Por qué existe: re-equipar sin flags pasaba todo al idioma de la interfaz, quitaba el método SDD y
// perdía la arquitectura acordada. Un flag explícito sigue ganando: el manifiesto es lo que el proyecto
// ya decidió, no una orden.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isSafeId } from './ids.mjs';

const NONE = Object.freeze({ lang: '', methods: [], architecture: null, skills: Object.freeze([]) });

// `"sdd:lite"` → { id: 'sdd', mode: 'lite' }; sin modo, el por defecto del método.
const methodOf = (entry) => {
  const [id, mode = ''] = String(entry).split(':');
  return { id, mode };
};

/** Las elecciones guardadas en `<projectPath>/.chalc.json`. Ausente, ilegible o viejo → sin elecciones. */
export async function readChoices(projectPath) {
  let raw;
  try { raw = JSON.parse(await readFile(join(projectPath, '.chalc.json'), 'utf8')); } catch { return NONE; }
  if (!raw || typeof raw !== 'object') return NONE;
  return {
    lang: raw.lang === 'es' || raw.lang === 'en' ? raw.lang : '',
    methods: Array.isArray(raw.methods) ? raw.methods.map(methodOf).filter((m) => m.id) : [],
    architecture: typeof raw.architecture?.name === 'string' && raw.architecture.name ? raw.architecture : null,
    // Las skills que el proyecto ya tenía equipadas (spec 026, R5): solo ids válidos; el resto se ignora.
    skills: Array.isArray(raw.skills) ? raw.skills.filter(isSafeId) : []
  };
}

/** Las entradas de `--method` que valen: las del usuario si dio alguna; si no, las recordadas. */
export const methodEntries = (flagged, choices) => (flagged.length
  ? flagged
  : choices.methods.map((m) => (m.mode ? `${m.id}:${m.mode}` : m.id)));
