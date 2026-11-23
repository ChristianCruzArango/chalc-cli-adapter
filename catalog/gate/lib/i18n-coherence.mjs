// i18n-coherence.mjs — redacción bilingüe de los problemas de coherencia (spec 024). Responsabilidad ÚNICA:
// decir en es y en cada hallazgo de `coherence.mjs`. Razón de cambio: el texto de esos mensajes.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// Vive aparte de `i18n.mjs` solo por tamaño; `MESSAGES` lo incluye, así que la paridad se exige igual.

import { RULES } from './rules.mjs';

export const COHERENCE = {
  es: {
    [RULES.activeSpecInvalid]: () => '.chalc/active-spec no nombra una carpeta specs/NNN-* que exista: corrige el nombre o borra el archivo; no se usa otra carpeta en su lugar',
    [RULES.specFileMissing]: (d) => `falta ${d.name} en la carpeta de la spec: no se toma el de una carpeta anterior`,
    [RULES.huEmpty]: () => 'la HU no tiene texto propio: copia aquí la historia tal cual la entregó el usuario',
    [RULES.huNoSource]: () => 'la HU no dice de dónde viene: añade una línea "Fuente:" con la URL o el archivo original',
    [RULES.huNoFragments]: () => 'la HU no declara fragmentos trazables: añade "- **HU-1** — <fragmento copiado literal>" por cada criterio',
    [RULES.huFragmentNotLiteral]: (d) => `el fragmento de ${d.id} no aparece tal cual en el texto de la HU: cópialo literal, sin parafrasear`,
    [RULES.huChanged]: () => 'la HU cambió después de que el usuario la aprobó: restáurala o pide al usuario que la apruebe de nuevo',
    [RULES.huUncited]: (d) => `ningún requisito de la spec cita ${d.id}: esa parte de la HU quedó sin cubrir`,
    [RULES.specNoRequirements]: () => 'la spec no declara ningún requisito: escribe cada uno como "- **R1** (HU-1) — WHEN … THE SYSTEM SHALL …"',
    [RULES.requirementNotEars]: (d) => `${d.id} no está en forma EARS: le falta SHALL (o DEBE) para poder convertirse en un test`,
    [RULES.needsClarification]: () => 'queda un [NEEDS CLARIFICATION] sin resolver: pregunta al usuario; no se inventa la respuesta',
    [RULES.requirementNoHu]: (d) => `${d.id} no cita ningún fragmento HU-n: un requisito que no sale de la HU es inventado`,
    [RULES.requirementUnknownHu]: (d) => `${d.id} cita ${d.hu}, que la HU no declara`,
    [RULES.requirementUncovered]: (d) => `ninguna tarea cubre ${d.id}: añade la tarea que lo implementa`,
    [RULES.planUnknownRequirement]: (d) => `el plan cita ${d.id}, que la spec no declara`,
    [RULES.taskNoRequirement]: () => 'la tarea no cita ningún requisito: toda tarea apunta a un R# de la spec',
    [RULES.taskUnknownRequirement]: (d) => `la tarea cita ${d.id}, que la spec no declara`,
    [RULES.tasksEmpty]: () => 'tasks.md no tiene ninguna tarea ("- [ ] **T1** (R1) — …")',
    [RULES.probesMissing]: () => 'el plan declara una superficie api o cli y falta probes.json: las sondas que el servicio levantado tiene que cumplir (peticiones o comandos, con lo que se espera). Se escribe a partir de specs/_template/probes.json y se aprueba con la spec.',
    [RULES.probesInvalid]: (d) => `probes.json no se puede ejecutar (${d.problem}): cada sonda necesita nombre, url o command, y expect con lo que se espera.`,
    [RULES.designMissing]: () => 'el plan declara una interfaz (Superficie: ui) y falta design.md: la composición de cada pantalla se decide y se aprueba antes de programarla. Lo escribe el rol disenador a partir de specs/_template/design.md y del contrato (.chalc/design.contract.json).',
    [RULES.specNotApproved]: (d) => `la spec de ${d.dir} no tiene una aprobación vigente del usuario. Solo el usuario aprueba, en SU terminal, con \`node .chalc/gate.mjs --approve-spec\`; el asistente PARA y espera`,
    [RULES.guardNoVerify]: (d) => `Bloqueado: \`${d.command}\`. Saltarse los hooks de git (\`--no-verify\`) es decisión de una persona, no del asistente: corre el portón y corrige lo que reporte.`,
    [RULES.guardIntegrationMerge]: (d) => `Bloqueado: \`${d.command}\`. Fusionar la rama chalc/int-… es la aprobación del cierre de la feature y la hace el usuario, en su terminal. PARA y entrégale el informe (\`node .chalc/team.mjs report --feature <nombre>\`).`,
    [RULES.guardApprove]: (d) => `Bloqueado: \`${d.command}\`. La spec la aprueba el usuario, nunca el asistente. PARA y pídele que lo ejecute en su terminal: \`node .chalc/gate.mjs --approve-spec\`.`
  },
  en: {
    [RULES.activeSpecInvalid]: () => '.chalc/active-spec does not name an existing specs/NNN-* folder: fix the name or delete the file; no other folder is used instead',
    [RULES.specFileMissing]: (d) => `${d.name} is missing from the spec folder: the one from an earlier folder is not used`,
    [RULES.huEmpty]: () => 'the user story has no text of its own: copy the story here exactly as the user delivered it',
    [RULES.huNoSource]: () => 'the user story does not say where it comes from: add a "Source:" line with the original URL or file',
    [RULES.huNoFragments]: () => 'the user story declares no traceable fragments: add "- **HU-1** — <fragment copied verbatim>" for each criterion',
    [RULES.huFragmentNotLiteral]: (d) => `the fragment of ${d.id} does not appear verbatim in the user story text: copy it literally, without paraphrasing`,
    [RULES.huChanged]: () => 'the user story changed after the user approved it: restore it or ask the user to approve it again',
    [RULES.huUncited]: (d) => `no requirement in the spec cites ${d.id}: that part of the user story is left uncovered`,
    [RULES.specNoRequirements]: () => 'the spec declares no requirement: write each one as "- **R1** (HU-1) — WHEN … THE SYSTEM SHALL …"',
    [RULES.requirementNotEars]: (d) => `${d.id} is not in EARS form: it lacks SHALL, so it cannot become a test`,
    [RULES.needsClarification]: () => 'an unresolved [NEEDS CLARIFICATION] remains: ask the user; the answer is not made up',
    [RULES.requirementNoHu]: (d) => `${d.id} cites no HU-n fragment: a requirement that does not come from the user story is invented`,
    [RULES.requirementUnknownHu]: (d) => `${d.id} cites ${d.hu}, which the user story does not declare`,
    [RULES.requirementUncovered]: (d) => `no task covers ${d.id}: add the task that implements it`,
    [RULES.planUnknownRequirement]: (d) => `the plan cites ${d.id}, which the spec does not declare`,
    [RULES.taskNoRequirement]: () => 'the task cites no requirement: every task points to an R# of the spec',
    [RULES.taskUnknownRequirement]: (d) => `the task cites ${d.id}, which the spec does not declare`,
    [RULES.tasksEmpty]: () => 'tasks.md has no task ("- [ ] **T1** (R1) — …")',
    [RULES.probesMissing]: () => 'the plan declares an api or cli surface and probes.json is missing: the probes the running service has to meet (requests or commands, with what is expected). It is written from specs/_template/probes.json and approved with the spec.',
    [RULES.probesInvalid]: (d) => `probes.json cannot be run (${d.problem}): each probe needs a name, url or command, and expect with what is expected.`,
    [RULES.designMissing]: () => 'the plan declares an interface (Surface: ui) and design.md is missing: the composition of each screen is decided and approved before it is coded. The disenador role writes it from specs/_template/design.md and the contract (.chalc/design.contract.json).',
    [RULES.specNotApproved]: (d) => `the spec in ${d.dir} has no current approval from the user. Only the user approves, in THEIR terminal, with \`node .chalc/gate.mjs --approve-spec\`; the assistant STOPS and waits`,
    [RULES.guardNoVerify]: (d) => `Blocked: \`${d.command}\`. Skipping the git hooks (\`--no-verify\`) is a person's decision, not the assistant's: run the gate and fix what it reports.`,
    [RULES.guardIntegrationMerge]: (d) => `Blocked: \`${d.command}\`. Merging the chalc/int-… branch is the approval of the feature's close and the user does it, in their terminal. STOP and hand them the report (\`node .chalc/team.mjs report --feature <name>\`).`,
    [RULES.guardApprove]: (d) => `Blocked: \`${d.command}\`. The spec is approved by the user, never by the assistant. STOP and ask them to run it in their terminal: \`node .chalc/gate.mjs --approve-spec\`.`
  }
};

// Por qué una herramienta de `.chalc/` no pasa la comprobación de integridad (spec 029, R8), según su motivo.
export const TOOLING = {
  es: {
    altered: 'esta herramienta de chalc fue modificada después de equipar: el portón no mide con herramientas alteradas. Re-equipa el repo con chalc para restaurarla',
    missing: 'falta esta herramienta de chalc: re-equipa el repo con chalc para restaurarla',
    'no-manifest': 'falta el manifiesto de integridad de las herramientas de chalc, o no se puede leer: re-equipa el repo con chalc'
  },
  en: {
    altered: 'this chalc tool was modified after equipping: the gate does not measure with altered tools. Re-equip the repo with chalc to restore it',
    missing: 'this chalc tool is missing: re-equip the repo with chalc to restore it',
    'no-manifest': 'the integrity manifest of the chalc tools is missing or unreadable: re-equip the repo with chalc'
  }
};
