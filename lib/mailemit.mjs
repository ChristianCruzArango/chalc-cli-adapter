// lib/mailemit.mjs — emisión del buzón dentro de un repo equipado (spec 010, R6).
// Responsabilidad ÚNICA: decir QUÉ se emite del buzón. Razón de cambio: qué archivos lo componen.
// La mecánica de copiar vive en `emittree.mjs`.
//
// Va aparte del advisor porque hacen cosas opuestas: aquél observa y no escribe (spec 008, R8), y
// esa propiedad es la que lo hace fiable; este escribe. Un solo artefacto que hiciera ambas cosas
// dejaría de poder responder honestamente en qué punto va el ciclo.
//
// El buzón NO tiene configuración propia: los lados y su carpeta viven en `.chalc/gate.json`, sección
// `flow.sides`. Por eso `emitMail` solo copia — nada que fusionar, nada que preservar.
//
// Invariante: todo lo emitido cuelga de `.chalc/` y solo importa builtins de node o rutas relativas
// dentro de esa carpeta — corre con `node .chalc/mail.mjs` aunque chalc no esté instalado.

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emitTree, launcherFor } from './emittree.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const MAIL_DIR = join(ROOT, 'catalog', 'mail');   // origen por defecto del buzón
export const MAIL_REL = '.chalc/mail.mjs';               // entrada, tal como se invoca desde el repo

// Emite el buzón en `projectPath`. `sourceDir` es inyectable para poder probar la copia sin depender
// de su contenido. Devuelve { written }.
export async function emitMail(projectPath, { sourceDir = MAIL_DIR } = {}) {
  const written = await emitTree(projectPath, {
    sourceDir,
    subdir: 'mail',
    launcherRel: MAIL_REL,
    launcher: launcherFor('mail', 'mail.mjs', 'Buzón entre lados: envía un aviso corto al otro lado y marca los recibidos.')
  });

  return { written };
}
