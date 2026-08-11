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
  mutation: { tool: '', command: '', report: '', format: '', install: '', probe: '', scopeFlag: '', scopeJoin: '', threshold: 80, required: true },
  lint: {
    maxFileLines: 300, maxFunctionLines: 40, maxParams: 4, maxDepth: 3,
    // Duplicación (spec 012). Mínimo conservador a propósito: esta etapa vive o muere por los falsos
    // positivos, y un linter que se equivoca se acaba apagando entero.
    duplication: { enabled: true, minLines: 6, maxFiles: 4000 }
  },
  spec: { dir: 'specs' },
  // Cómo se TRABAJA, frente al resto de la config, que dice cómo se MIDE (spec 008, R17). Comparte
  // archivo porque es el mismo ciclo y porque la fusión de R16 ya está resuelta aquí. Los defaults
  // son el comportamiento de siempre: sin ellos, actualizar chalc encadenaría tareas sin que nadie
  // las apruebe.
  flow: {
    approvals: { task: true, feature: true },
    review: { required: true },
    // Coordinación entre lados (spec 010). Apagada por defecto: el caso común es el mono-repo, que no
    // tiene con quién coordinarse. La rellena `chalc feature` en modo worktree, que es el único que
    // sabe qué lados existen.
    sides: { me: '', owner: '', peers: [], mail: '', enabled: false }
  },
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
