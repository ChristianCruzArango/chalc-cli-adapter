// lib/roleconfig.mjs — la config efectiva de un ROL/PARTICIPANTE que corre en su propio proveedor.
// Responsabilidad ÚNICA: traducir una entrada de `cli.roles` a la config con la que se llama a la IA.
// Razón de cambio: cómo se declara un rol en la config.
//
// Vivía dentro de `cli/session.mjs` cuando su único consumidor era el harness. Con `chalc debate`
// (spec 014, R2) pasa a tener dos, y el segundo está en `lib/`: un comando de `lib/` importando de
// `cli/` invertiría la dirección de las dependencias entre capas. Se mueve al núcleo compartido en
// vez de duplicarse, porque la regla que aplica —no cruzar credenciales entre servicios— es
// exactamente la que no puede tener dos versiones: la copia que se quede atrás no falla al leerse,
// falla con un 401 en mitad de una llamada que el usuario ya pagó.

import { isStaleModel } from './ai.mjs';

// Config efectiva de un ROL (cli.roles.planner|coder|reviewer|debateA|debateB…). Dos formas en la config:
//   - string: otro MODELO del mismo proveedor de la sesión (comportamiento clásico).
//   - objeto {provider, model, apiKey?, baseURL?}: el rol corre en OTRO proveedor (p. ej. planner en
//     OpenRouter con Opus, reviewer en OpenAI, coder en Ollama local). La config del rol se arma SIN
//     heredar apiKey/baseURL/apiVersion del proveedor base — cruzar credenciales entre servicios
//     rompe la llamada (una key de OpenRouter no abre OpenAI). cli.* sí se hereda (timeouts, think…).
// Devuelve null si el rol no está configurado o el objeto está incompleto → usa el impl base.
//
// No conoce ningún nombre de rol: si los conociera, añadir los participantes del debate habría sido
// tocar esta función.
export function roleConfig(cfg, role) {
  const m = cfg?.cli?.roles?.[role];
  if (!m) return null;
  // string fijado cuando el proveedor base era OTRO (p. ej. `qwen3-coder:30b` de Ollama y ahora
  // OpenRouter): ese nombre no existe en el proveedor actual → uso el modelo base en vez de un 400.
  if (typeof m === 'string') return isStaleModel(cfg, m, cfg?.cli?.rolesFor) ? null : { ...cfg, model: m };
  if (!m.provider || !m.model) return null;
  const { baseURL: _b, apiKey: _k, apiVersion: _v, ...base } = cfg || {};
  return { ...base, ...m };
}

// Etiqueta del modelo de un rol para la UI ("pensando con X…"): el nombre a secas si es del mismo
// proveedor, "modelo (proveedor)" si el rol corre en otro. null = rol sin configurar (modelo base).
export function roleModelLabel(cfg, role) {
  const m = cfg?.cli?.roles?.[role];
  if (!m) return null;
  if (typeof m === 'string') return isStaleModel(cfg, m, cfg?.cli?.rolesFor) ? null : m;   // null: se usa el base
  return m.provider && m.model ? `${m.model} (${m.provider})` : null;
}
