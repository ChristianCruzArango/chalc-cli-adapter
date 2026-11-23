// lib/targetkit/speccommand.mjs — el comando `chalc-spec` (spec 024, R20, R24). Responsabilidad ÚNICA: el texto
// que guía al asistente desde la HU hasta la spec lista para que el USUARIO la apruebe. Razón de cambio: los
// pasos de ese recorrido. Dónde y cómo lo escribe cada harness lo sabe `command.mjs`.
//
// Es prosa a propósito: el recorrido lo decide el advisor (`node .chalc/next.mjs`) y lo hacen cumplir el portón
// y la guarda. Este texto solo pone al asistente en el camino y le dice dónde tiene que PARAR.

import { commandFile, writeCommand } from './command.mjs';

export const SPEC_COMMAND = 'chalc-spec';

const TEXT = {
  es: {
    description: 'Convierte una historia de usuario (URL de Azure DevOps o Jira, archivo o texto) en una spec lista para que el usuario la apruebe.',
    body: [
      'Prepara la spec de una historia de usuario (HU). **Ni tests ni código** hasta que el usuario la apruebe.',
      '',
      'La fuente es lo que el usuario escribió junto al comando: una URL de Azure DevOps o de Jira, otra URL, la ruta de un archivo o el propio texto de la HU. Si no dio ninguna, pídesela: no inventes la historia.',
      '',
      '1. **Antes de escribir nada, lee** las reglas propias del proyecto si existen (`CLAUDE.md`, `AGENTS.md`), `specs/constitution.md` y las plantillas de `specs/_template/` (hu, spec, plan y tasks; si existen, también research, data-model y quickstart). Se rellena su estructura exacta, nunca formato libre.',
      '2. **Trae la HU tal cual, sin resumirla ni corregirla:**',
      '   - Azure DevOps: `chalc spec --azure <url>` · Jira: `chalc spec --jira <url> --email <correo>` · otra URL: `chalc spec --url <url>` · archivo: `chalc spec --doc <ruta>`.',
      '   - Ese comando crea la siguiente `specs/NNN-nombre/` y copia el texto en su `hu.md`, con la línea `Fuente:`. No usa ningún modelo.',
      '   - Las credenciales salen del entorno del usuario (`CHALC_PAT` para Azure, `CHALC_TOKEN` para Jira). **Nunca pidas que peguen un token en el chat** ni lo escribas en un archivo: si falta, pide al usuario que ejecute él ese comando en su terminal.',
      '   - Si la HU es texto pegado: crea la carpeta con `chalc spec <nombre>` y copia el texto literal en `hu.md`, con `Fuente: texto entregado por el usuario`.',
      '   - Dile al usuario dónde quedó `hu.md` y pídele confirmar que esa es la HU.',
      '3. **La redacta el agente `especificador`**: declara los fragmentos `HU-n` en `hu.md` y escribe `spec.md`, `plan.md` y `tasks.md` en ESA carpeta. Lo ambiguo queda como `[NEEDS CLARIFICATION]` y se le pregunta al usuario; la respuesta no se inventa.',
      '4. **Sigue al advisor**: corre `node .chalc/next.mjs`, haz lo que diga y vuelve a preguntarle.',
      '   - `fix_specs`: corrige lo que lista, con su archivo y línea.',
      '   - `call_role analista`: la revisa el agente `analista` contra la HU, no quien la escribió. Con `fix_review`, se corrigen sus hallazgos.',
      '   - `approve_spec`: **PARA**. Solo el usuario aprueba la spec, en SU terminal, con `node .chalc/gate.mjs --approve-spec`. No ejecutes ese comando, no escribas el sello a mano y no des la spec por aprobada.',
      '5. Entrega un resumen: la carpeta, cuántos requisitos y tareas, las dudas abiertas y el comando de aprobación.',
      '6. **Con la spec aprobada y commiteada, sigue por el mismo motor que `chalc-teams`, con una sola spec:** `node .chalc/team.mjs open --feature <nombre> <carpeta>`, `node .chalc/team.mjs waves --feature <nombre>` y `node .chalc/team.mjs dispatch --spec <carpeta> --role lider`. La desarrolla un `desarrollador` en su worktree, la revisan `seguridad` y `revisor` sobre la entrega, y tú entregas el informe (`node .chalc/team.mjs report --feature <nombre>`).',
      '',
      'Antes de la aprobación del usuario no se toca ningún archivo fuera de `specs/` y `.chalc/review.md`.'
    ]
  },
  en: {
    description: 'Turns a user story (Azure DevOps or Jira URL, file or text) into a spec ready for the user to approve.',
    body: [
      'Prepare the spec of a user story. **No tests or code** until the user approves it.',
      '',
      'The source is whatever the user wrote next to the command: an Azure DevOps or Jira URL, another URL, a file path or the story text itself. If none was given, ask for it: do not make the story up.',
      '',
      '1. **Before writing anything, read** the project\'s own rules if they exist (`CLAUDE.md`, `AGENTS.md`), `specs/constitution.md` and the templates in `specs/_template/` (hu, spec, plan and tasks; if present, also research, data-model and quickstart). Their exact structure is filled in, never free form.',
      '2. **Bring the user story verbatim, without summarising or correcting it:**',
      '   - Azure DevOps: `chalc spec --azure <url>` · Jira: `chalc spec --jira <url> --email <address>` · another URL: `chalc spec --url <url>` · file: `chalc spec --doc <path>`.',
      '   - That command creates the next `specs/NNN-name/` and copies the text into its `hu.md`, with the `Source:` line. It uses no model.',
      '   - Credentials come from the user\'s environment (`CHALC_PAT` for Azure, `CHALC_TOKEN` for Jira). **Never ask for a token to be pasted into the chat**, nor write it to a file: if it is missing, ask the user to run that command themselves in their terminal.',
      '   - If the story is pasted text: create the folder with `chalc spec <name>` and copy the text literally into `hu.md`, with `Source: text delivered by the user`.',
      '   - Tell the user where `hu.md` ended up and ask them to confirm that this is the story.',
      '3. **The `especificador` agent drafts it**: it declares the `HU-n` fragments in `hu.md` and writes `spec.md`, `plan.md` and `tasks.md` in THAT folder. Anything ambiguous stays as `[NEEDS CLARIFICATION]` and the user is asked; the answer is not made up.',
      '4. **Follow the advisor**: run `node .chalc/next.mjs`, do what it says and ask it again.',
      '   - `fix_specs`: fix what it lists, with its file and line.',
      '   - `call_role analista`: the `analista` agent reviews it against the story, not whoever wrote it. On `fix_review`, its findings get fixed.',
      '   - `approve_spec`: **STOP**. Only the user approves the spec, in THEIR terminal, with `node .chalc/gate.mjs --approve-spec`. Do not run that command, do not write the seal by hand, and do not treat the spec as approved.',
      '5. Hand over a summary: the folder, how many requirements and tasks, the open questions and the approval command.',
      '6. **With the spec approved and committed, go on through the same engine as `chalc-teams`, with a single spec:** `node .chalc/team.mjs open --feature <name> <folder>`, `node .chalc/team.mjs waves --feature <name>` and `node .chalc/team.mjs dispatch --spec <folder> --role lider`. A `desarrollador` builds it in its worktree, `seguridad` and `revisor` review the delivery, and you hand over the report (`node .chalc/team.mjs report --feature <name>`).',
      '',
      'Before the user\'s approval, no file outside `specs/` and `.chalc/review.md` is touched.'
    ]
  }
};

// En Claude Code lo invoca el usuario (`/chalc-spec <fuente>`): el modelo no decide por su cuenta abrir una spec.
const COMMAND = { name: SPEC_COMMAND, text: TEXT, claudeExtra: ['disable-model-invocation: true'] };

/** Dónde deja el comando `chalc-spec` un target, con '/'; '' si el target no existe. */
export const specCommandFile = (target) => commandFile(target, SPEC_COMMAND);

/** Escribe el comando `chalc-spec` de `target` en `projectPath`. Devuelve su ruta, o null si el target no existe. */
export const writeSpecCommand = (projectPath, target, specLang = '') => writeCommand(projectPath, target, COMMAND, specLang);
