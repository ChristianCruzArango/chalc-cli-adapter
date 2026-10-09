// config.mjs — carga de `.chalc/gate.json`. Responsabilidad ÚNICA: entregar la config del portón con
// sus valores por defecto. Razón de cambio: la forma de la configuración.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// Config ausente o ilegible NO es "todo por defecto": es un portón que no sabe qué comprobar, y eso
// se reporta como bloqueo. Lo contrario sería aprobar una tarea por no encontrar un archivo.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { frameOf } from './i18n.mjs';

export const CONFIG_REL = '.chalc/gate.json';

const DEFAULTS = {
  test: { command: '' },
  mutation: { tool: '', command: '', report: '', format: '', install: '', probe: '', scopeFlag: '', scopeJoin: '', projectFlag: '', threshold: 80, required: true },
  lint: {
    maxFileLines: 300, maxFunctionLines: 40, maxParams: 4, maxDepth: 3,
    // Duplicación (spec 012). Mínimo conservador a propósito: esta etapa vive o muere por los falsos
    // positivos, y un linter que se equivoca se acaba apagando entero.
    duplication: { enabled: true, minLines: 6, maxFiles: 4000 }
  },
  // Seguridad (spec 014). Encendida por defecto: un repo equipado antes de esta spec no trae la
  // clave, y apagarla tiene que ser una decisión escrita, no el efecto de una config vieja.
  security: { enabled: true },
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

// Los umbrales que chalc copia a cada gate.json al equipar (lib/gatedetect.mjs): los mismos que el
// portón aplica si faltan, para que no existan dos versiones de "lo que viene por defecto".
export const LINT_DEFAULTS = DEFAULTS.lint;
export const MUTATION_THRESHOLD = DEFAULTS.mutation.threshold;

// Lee la config del repo. Devuelve { config, error }: `error` con texto cuando no se pudo cargar,
// para que el llamador lo convierta en bloqueo en vez de seguir a ciegas.
// Sin gate.json no se sabe el idioma del proyecto: se toma el del entorno, para que el motivo del
// bloqueo y el marco del informe hablen el mismo idioma.
export const envLanguage = () => (/^es\b|^es[_-]/i.test(process.env.CHALC_LANG || process.env.LC_ALL || process.env.LANG || '') ? 'es' : 'en');

export async function loadConfig(root) {
  let text;
  try {
    text = await readFile(join(root, CONFIG_REL), 'utf8');
  } catch {
    const language = envLanguage();
    return { config: merge(DEFAULTS, { language }), error: frameOf(language).configMissing(CONFIG_REL) };
  }

  let config;
  try {
    config = merge(DEFAULTS, JSON.parse(text));
  } catch (err) {
    const language = envLanguage();
    return { config: merge(DEFAULTS, { language }), error: frameOf(language).configInvalid(CONFIG_REL, err.message) };
  }
  return { config, error: thresholdError(config) };
}

// `mutation.threshold` debe ser un número en [0, 100] (G-05): `-1` aprobaba cualquier score y un
// string caía a 80 en silencio en mutation.mjs. Un umbral inválido bloquea, como una config ilegible.
function thresholdError(config) {
  const value = config.mutation?.threshold;
  if (typeof value === 'number' && value >= 0 && value <= 100) return '';
  return frameOf(config.language || envLanguage()).configThresholdInvalid(CONFIG_REL, JSON.stringify(value) ?? String(value));
}
