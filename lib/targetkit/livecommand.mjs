// lib/targetkit/livecommand.mjs — el comando `chalc-live` (spec 021, R9). Responsabilidad ÚNICA: el texto del
// comando que levanta el tablero y entrega su URL. Razón de cambio: qué hace ese comando.
//
// Una pregunta libre («¿cómo vamos?») no siempre se reconoce; un comando sí: `/chalc-live` (en Codex,
// `$chalc-live`). Dónde y cómo lo escribe cada harness lo sabe `command.mjs`; aquí vive lo que DICE.

import { commandFile, writeCommand } from './command.mjs';

export const LIVE_COMMAND = 'chalc-live';

const TEXT = {
  es: {
    description: 'Levanta el tablero en vivo del proyecto y responde con su URL.',
    body: [
      'Levanta el tablero en vivo del proyecto y entrega su URL.',
      '',
      '1. Corre `node .chalc/live.mjs` desde la raíz del proyecto.',
      '2. Responde SOLO con la URL que imprime: el tablero muestra en qué tarea va, qué corrió el portón, las notas de cada rol y lo que falta, y se actualiza solo.',
      '',
      'No describas el estado tú: la página lo muestra.'
    ]
  },
  en: {
    description: 'Starts the project\'s live board and answers with its URL.',
    body: [
      'Start the project\'s live board and hand over its URL.',
      '',
      '1. Run `node .chalc/live.mjs` from the project root.',
      '2. Answer ONLY with the URL it prints: the board shows the task in progress, what the gate ran, each role\'s notes and what is missing, and it updates itself.',
      '',
      'Do not describe the state yourself: the page shows it.'
    ]
  }
};

const COMMAND = {
  name: LIVE_COMMAND,
  text: TEXT,
  // En Claude Code lo invoca el usuario, y solo puede correr el tablero.
  claudeExtra: ['disable-model-invocation: true', 'allowed-tools: Bash(node .chalc/live.mjs)']
};

/** Dónde deja el comando `chalc-live` un target, con '/'; '' si el target no existe. */
export const liveCommandFile = (target) => commandFile(target, LIVE_COMMAND);

/** Escribe el comando `chalc-live` de `target` en `projectPath`. Devuelve su ruta, o null si el target no existe. */
export const writeLiveCommand = (projectPath, target, specLang = '') => writeCommand(projectPath, target, COMMAND, specLang);
