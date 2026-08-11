// lib/nextemit.mjs — emisión del advisor dentro de un repo equipado (spec 008, R1).
// Responsabilidad ÚNICA: decir QUÉ se emite del advisor. Razón de cambio: qué archivos lo componen.
// La mecánica de copiar vive en `emittree.mjs`.
//
// Va aparte de `lib/gateemit.mjs` porque son dos artefactos con razones de cambio distintas, aunque
// se emitan seguidos. Lo que sí los ata es el orden: el advisor importa `changed.mjs` del portón
// (spec 008, R13), así que **el portón tiene que emitirse primero**. El llamador lo garantiza
// invocando `emitGate()` antes; aquí no se comprueba porque no es cosa de este módulo saberlo.
//
// El advisor NO tiene configuración propia: sus puertas viven en `.chalc/gate.json`, sección `flow`
// (R17). Por eso `emitNext` solo copia — nada que fusionar, nada que preservar.
//
// Invariante (R2): todo lo emitido cuelga de `.chalc/` y solo importa builtins de node o rutas
// relativas dentro de esa carpeta — el advisor corre con `node .chalc/next.mjs` aunque chalc no
// esté instalado en el repo destino.

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emitTree, launcherFor } from './emittree.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const NEXT_DIR = join(ROOT, 'catalog', 'next');   // origen por defecto del advisor
export const NEXT_REL = '.chalc/next.mjs';               // entrada, tal como se invoca en los hand-offs

// Emite el advisor en `projectPath`. `sourceDir` es inyectable para poder probar la copia sin
// depender del contenido del advisor. Devuelve { written }.
export async function emitNext(projectPath, { sourceDir = NEXT_DIR } = {}) {
  const written = await emitTree(projectPath, {
    sourceDir,
    subdir: 'next',
    launcherRel: NEXT_REL,
    launcher: launcherFor('next', 'next.mjs', 'Advisor de flujo: dice cuál es la ÚNICA acción siguiente del ciclo de tarea.')
  });

  return { written };
}
