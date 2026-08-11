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

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectGateConfig, pendingKeys } from './gatedetect.mjs';
import { emitTree, launcherFor } from './emittree.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const GATE_DIR = join(ROOT, 'catalog', 'gate');   // origen por defecto del portón
export const GATE_REL = '.chalc/gate.mjs';               // entrada, tal como se invoca en los hand-offs
export const GATE_CONFIG_REL = '.chalc/gate.json';       // única superficie de configuración

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// Fusión de config (R16): lo ya escrito en el proyecto gana sobre lo detectado, y lo detectado
// aporta únicamente las claves que faltaban (una versión nueva de chalc no puede exigir que el
// usuario reconstruya su gate.json, ni pisarle lo que ajustó).
function mergeConfig(detected, existing) {
  const merged = { ...detected };
  for (const [key, value] of Object.entries(existing || {})) {
    merged[key] = isPlainObject(value) && isPlainObject(detected[key]) ? mergeConfig(detected[key], value) : value;
  }
  return merged;
}

// La config que el repo ya tenía. Un gate.json corrupto se descarta y se cae a la detección: es
// preferible un portón que corre con la config detectada a uno que no arranca.
async function existingConfig(projectPath) {
  const file = join(projectPath, GATE_CONFIG_REL);
  if (!existsSync(file)) return null;
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return null; }
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
  const merged = mergeConfig(detected, await existingConfig(projectPath));
  const config = {
    ...merged,
    stack: detected.stack,                          // derivado del repo: se recalcula
    role: role || merged.role || '',
    language: language || merged.language || '',
    pending: pendingKeys(merged)                    // derivado de la config final, no del detectado
  };
  await writeFile(join(projectPath, GATE_CONFIG_REL), JSON.stringify(config, null, 2) + '\n', 'utf8');
  written.push(GATE_CONFIG_REL);

  return { written, config };
}
