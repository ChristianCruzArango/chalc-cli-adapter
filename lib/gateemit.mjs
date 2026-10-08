// lib/gateemit.mjs — emisión del portón de calidad dentro de un repo equipado (spec 007, R1).
// Responsabilidad ÚNICA: dejar en `.chalc/` un portón EJECUTABLE y su configuración. Razón de cambio:
// qué archivos componen el portón. No detecta (eso es gatedetect.mjs) ni ejecuta nada.
//
// El portón se COPIA, no se genera con plantillas de texto: `catalog/gate/` es código real, con sus
// tests en este repo. Los linters que chalc ya tenía (fronteras, rutas de contrato) viven dentro de
// ese árbol y `lib/` los re-exporta, así que aquí no hay nada especial que llevar: se copia el árbol
// entero y punto.
//
// Invariante (R18): todo lo emitido cuelga de `.chalc/` y solo importa builtins de node o rutas
// relativas dentro de esa carpeta — el portón corre con `node .chalc/gate.mjs` aunque chalc no esté
// instalado en el repo destino.

import { writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectGateConfig, pendingKeys } from './gatedetect.mjs';
import { emitTree, launcherFor } from './emittree.mjs';
import { readJsonOrKeep } from './userdata.mjs';
import { CONFIG_REL } from '../catalog/gate/lib/config.mjs';
import { isPlainObject } from '../catalog/gate/lib/data.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const GATE_DIR = join(ROOT, 'catalog', 'gate');   // origen por defecto del portón
export const GATE_REL = '.chalc/gate.mjs';               // entrada, tal como se invoca en los hand-offs
export const GATE_CONFIG_REL = CONFIG_REL;       // única superficie de configuración


// Fusión de config (R16): lo ya escrito en el proyecto gana sobre lo detectado, y lo detectado
// aporta únicamente las claves que faltaban (una versión nueva de chalc no puede exigir que el
// usuario reconstruya su gate.json, ni pisarle lo que ajustó).
function mergeConfig(detected, existing) {
  const merged = { ...detected };
  for (const [key, value] of Object.entries(existing || {})) {
    merged[key] = isPlainObject(value) && isPlainObject(detected[key]) ? mergeConfig(detected[key], value) : value;
  }
  if (isPlainObject(merged.flow) && Array.isArray(detected.flow?.roles)) {
    merged.flow = { ...merged.flow, roles: mergeRoles(detected.flow.roles, existing?.flow?.roles) };
  }
  return merged;
}

// Claves con las que la etapa de mutación acota la corrida a lo que cambió la tarea (spec 016, R4;
// `projectFlag`, spec 018).
const MUTATION_SCOPE_KEYS = ['scopeFlag', 'scopeSpan', 'scopeJoin', 'projectFlag'];

// Excepción a R16 (spec 016, R4): en estas claves un vacío no es una decisión del usuario, es el
// valor que escribía una versión de chalc que todavía no sabía acotar. Si ganara, la mutación
// seguiría corriendo sin acotar aunque el catálogo ya sepa hacerlo.
function withCatalogMutationScope(merged, detected) {
  const mutation = { ...merged.mutation };
  for (const key of MUTATION_SCOPE_KEYS) {
    if (!mutation[key] && detected.mutation?.[key]) mutation[key] = detected.mutation[key];
  }
  return { ...merged, mutation };
}

// Los roles se fusionan POR ID, no como un valor más. Conservar el array existente entero dejaba fuera
// los roles nuevos del catálogo: un repo equipado antes de que existiera `seguridad` recibía su agente
// pero el advisor nunca lo exigía, y el control OWASP quedaba inactivo sin aviso. Lo que el usuario
// ajustó en un rol (apagarlo con `required: false`, cambiar su cadencia) gana; las claves que falten
// las aporta el catálogo; y un rol del catálogo que no estaba se añade. Para desactivar uno, `required: false`.
export function mergeRoles(detected = [], existing) {
  if (!Array.isArray(existing)) return detected;
  const mine = new Map(existing.filter(isPlainObject).map((r) => [r.id, r]));
  const fromCatalog = detected.map((r) => (mine.has(r.id) ? { ...r, ...mine.get(r.id) } : r));
  const custom = existing.filter((r) => isPlainObject(r) && !detected.some((d) => d.id === r.id));
  return [...fromCatalog, ...custom];
}

// Los ids de rol que la fusión añadió respecto a lo que el repo tenía: se avisan al equipar.
const addedRoles = (before, after) => {
  if (!Array.isArray(before)) return [];
  const had = new Set(before.filter(isPlainObject).map((r) => r.id));
  return (after || []).map((r) => r.id).filter((id) => !had.has(id));
};

// La config que el repo ya tenía. Un gate.json corrupto cae a la detección —es preferible un portón
// que corre con la config detectada a uno que no arranca—, pero ANTES se respalda: sus comandos
// ajustados a mano no se pierden.
async function existingConfig(projectPath) {
  return readJsonOrKeep(join(projectPath, GATE_CONFIG_REL), null);
}

// Emite el portón en `projectPath`. `role` (back/front/movil) e `language` los aporta el llamador:
// no son señales del repo ni cosa que el usuario edite — un valor explícito manda sobre lo guardado,
// y sin valor se conserva lo que ya había. `sourceDir` es inyectable para poder probar la copia sin
// depender del contenido del portón. Devuelve { written, config }.
export async function emitGate(projectPath, { role = '', language = '', sourceDir = GATE_DIR } = {}) {
  const written = await emitTree(projectPath, {
    sourceDir,
    subdir: 'gate',
    launcherRel: GATE_REL,
    launcher: launcherFor('gate', 'gate.mjs', 'Portón de calidad: corre las etapas y escribe la evidencia en .chalc/gate.md.')
  });

  const detected = await detectGateConfig(projectPath, { role, language });
  const existing = await existingConfig(projectPath);
  const merged = withCatalogMutationScope(mergeConfig(detected, existing), detected);
  const config = {
    ...merged,
    stack: detected.stack,                          // derivado del repo: se recalcula
    role: role || merged.role || '',
    language: language || merged.language || '',
    pending: pendingKeys(merged)                    // derivado de la config final, no del detectado
  };
  await writeFile(join(projectPath, GATE_CONFIG_REL), JSON.stringify(config, null, 2) + '\n', 'utf8');
  written.push(GATE_CONFIG_REL);

  return { written, config, addedRoles: addedRoles(existing?.flow?.roles, config.flow?.roles) };
}
