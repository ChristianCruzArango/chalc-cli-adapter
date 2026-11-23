// blockstages.mjs — las etapas que NO miden: las que dicen por qué todavía no se puede medir. Responsabilidad
// ÚNICA: darles forma de etapa. Razón de cambio: qué puede impedir una corrida.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.

import { RULES } from './rules.mjs';

// La config que falta o no se puede leer, como etapa bloqueada.
export const noConfigStage = (error) => ({
  stage: 'tests', ok: false, blocked: true, reason: 'no-config', command: '', code: null, ms: 0,
  findings: [{ file: '', line: 0, rule: RULES.noTestCommand, data: { detail: error } }]
});

// La etapa que reporta un alcance con el que no se puede trabajar. No cuelga de ningún archivo —el
// problema no está EN un archivo, está en no saber cuáles son—, así que el informe la muestra por el
// nombre de su etapa.
export const scopeStage = (rule, data, blocked) => ({
  stage: 'scope', ok: false, blocked, reason: rule, command: '', code: null, ms: 0,
  findings: [{ file: '', line: 0, rule, data }]
});

// La etapa que se niega a medir con herramientas que no coinciden con su manifiesto.
export const toolingStage = (problems) => ({
  stage: 'tooling', ok: false, blocked: true, reason: RULES.toolingAltered, command: '', code: null, ms: 0,
  findings: problems.map(({ file, reason }) => ({ file, line: 1, rule: RULES.toolingAltered, data: { reason } }))
});

// La etapa que se niega a ejecutar comandos cambiados sin re-sellar.
export const configStage = (keys) => ({
  stage: 'config', ok: false, blocked: true, reason: RULES.commandsUnsealed, command: '', code: null, ms: 0,
  findings: [{ file: '', line: 0, rule: RULES.commandsUnsealed, data: { keys } }]
});
