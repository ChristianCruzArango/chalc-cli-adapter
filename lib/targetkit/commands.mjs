// lib/targetkit/commands.mjs — los comandos de proyecto que chalc deja en todo target. Responsabilidad ÚNICA:
// la lista. Razón de cambio: que aparezca o desaparezca un comando. Así cada target los planea y los escribe
// con una sola llamada, y estrenar un comando no es tocar tres targets.

import { liveCommandFile, writeLiveCommand } from './livecommand.mjs';
import { specCommandFile, writeSpecCommand } from './speccommand.mjs';
import { teamsCommandFile, writeTeamsCommand } from './teamscommand.mjs';

// En el orden en que se listan en el plan: el tablero (spec 021, R9) y la spec (spec 024, R20).
const COMMANDS = [
  { file: liveCommandFile, write: writeLiveCommand },
  { file: specCommandFile, write: writeSpecCommand },
  { file: teamsCommandFile, write: writeTeamsCommand }
];

/** Las líneas `command   <archivo>` del plan de `target`. */
export const commandPlanLines = (target) => COMMANDS.map((command) => `command   ${command.file(target)}`);

/** Escribe todos los comandos de `target` en `projectPath`, en el idioma del spec. Devuelve sus rutas. */
export async function writeCommands(projectPath, target, specLang = '') {
  const written = [];
  for (const command of COMMANDS) written.push(await command.write(projectPath, target, specLang));
  return written;
}
