// config.mjs — carga de `.chalc/gate.json`. Responsabilidad ÚNICA: entregar la config del portón con
// sus valores por defecto. Razón de cambio: la forma de la configuración.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// Config ausente o ilegible NO es "todo por defecto": es un portón que no sabe qué comprobar, y eso
// se reporta como bloqueo. Lo contrario sería aprobar una tarea por no encontrar un archivo.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const CONFIG_REL = '.chalc/gate.json';

const DEFAULTS = {
  test: { command: '' },
  mutation: { tool: '', command: '', report: '', format: '', install: '', probe: '', scopeFlag: '', threshold: 80, required: true },
  lint: { maxFileLines: 300, maxFunctionLines: 40, maxParams: 4, maxDepth: 3 },
  spec: { dir: 'specs' },
  role: '',
  language: 'en'
};

const merge = (defaults, given) => {
  const out = { ...defaults };
  for (const [key, value] of Object.entries(given || {})) {
    const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
    out[key] = isObject(value) && isObject(defaults[key]) ? merge(defaults[key], value) : value;
  }
  return out;
};

// Lee la config del repo. Devuelve { config, error }: `error` con texto cuando no se pudo cargar,
// para que el llamador lo convierta en bloqueo en vez de seguir a ciegas.
export async function loadConfig(root) {
  let text;
  try {
    text = await readFile(join(root, CONFIG_REL), 'utf8');
  } catch {
    return { config: merge(DEFAULTS, {}), error: `falta ${CONFIG_REL}: vuelve a equipar el repo con chalc` };
  }

  try {
    return { config: merge(DEFAULTS, JSON.parse(text)), error: '' };
  } catch (err) {
    return { config: merge(DEFAULTS, {}), error: `${CONFIG_REL} no es JSON válido: ${err.message}` };
  }
}
