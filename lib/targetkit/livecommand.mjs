// lib/targetkit/livecommand.mjs — el comando `chalc-live` en cada harness (spec 021, R9). Responsabilidad ÚNICA:
// escribir, en el formato nativo de cada uno, el comando que levanta el tablero y entrega su URL. Razón de
// cambio: cómo define cada harness sus comandos de proyecto.
//
// Una pregunta libre («¿cómo vamos?») no siempre se reconoce; un comando sí. Formatos y rutas de la documentación
// oficial de cada harness (2026-10-13): Claude Code, skill en `.claude/skills/` → `/chalc-live`; Codex y
// Antigravity, skill en `.agents/skills/` → `$chalc-live` y `/chalc-live`; Cursor, `.cursor/commands/*.md`; Copilot, `.github/prompts/*.prompt.md`.
//
// El texto va en el idioma del SPEC (vive en el repo del usuario, como el bloque de AGENTS.md). Un archivo con ese
// nombre que no lleva la marca de chalc es del usuario: se respalda antes de reemplazarlo.

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { contentLang } from '../contentlang.mjs';
import { backupBeforeReplace } from '../userdata.mjs';
import { MANAGED_MARK, yamlScalar } from './formats.mjs';
import { blockText } from './blocktext.mjs';

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

// La marca va en el idioma del spec, como el resto del archivo (spec 022, C2).
const markOf = (code) => `<!-- ${MANAGED_MARK}: ${blockText(code).managedNote} -->`;
const skill = (tx, extra = []) => ['---', `name: ${LIVE_COMMAND}`, `description: ${yamlScalar(tx.description)}`, ...extra, '---', '', tx.mark, '', ...tx.body, ''].join('\n');

// Cada harness: dónde lee sus comandos y cómo se escribe el archivo.
const FORMATS = {
  claude: { file: ['.claude', 'skills', LIVE_COMMAND, 'SKILL.md'], render: (tx) => skill(tx, ['disable-model-invocation: true', 'allowed-tools: Bash(node .chalc/live.mjs)']) },
  codex: { file: ['.agents', 'skills', LIVE_COMMAND, 'SKILL.md'], render: (tx) => skill(tx) },
  antigravity: { file: ['.agents', 'skills', LIVE_COMMAND, 'SKILL.md'], render: (tx) => skill(tx) },
  cursor: { file: ['.cursor', 'commands', `${LIVE_COMMAND}.md`], render: (tx) => [tx.mark, '', ...tx.body, ''].join('\n') },
  copilot: { file: ['.github', 'prompts', `${LIVE_COMMAND}.prompt.md`], render: (tx) => ['---', `description: ${yamlScalar(tx.description)}`, '---', '', tx.mark, '', ...tx.body, ''].join('\n') }
};

/** Dónde deja el comando `chalc-live` un target, con '/'; '' si el target no existe. */
export const liveCommandFile = (target) => FORMATS[target]?.file.join('/') || '';

/** Escribe el comando `chalc-live` de `target` en `projectPath`. Devuelve su ruta, o null si el target no existe. */
export async function writeLiveCommand(projectPath, target, specLang = '') {
  const format = FORMATS[target];
  if (!format) return null;
  const path = join(projectPath, ...format.file);
  if (existsSync(path) && !(await readFile(path, 'utf8')).includes(MANAGED_MARK)) await backupBeforeReplace(projectPath, path, 'replaced');
  await mkdir(dirname(path), { recursive: true });
  const code = contentLang(specLang);
  await writeFile(path, format.render({ ...TEXT[code], mark: markOf(code) }));
  return path;
}
