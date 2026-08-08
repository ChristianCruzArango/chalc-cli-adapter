// tests.mjs — etapa de pruebas. Responsabilidad ÚNICA: correr la suite del repo y decir si pasó.
// Razón de cambio: cómo se ejecuta y se juzga la suite.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// El veredicto es el código de salida del runner, no su stdout: un "0 failing" impreso en pantalla
// es texto, y el texto se puede fabricar. Sin comando configurado la etapa BLOQUEA — es lo único
// que el portón no puede suplir, porque sin pruebas no hay nada que verificar.

import { runCommand } from './run.mjs';
import { RULES } from './rules.mjs';

// Corre la suite. `run` va inyectado para poder probar las decisiones sin ejecutar nada.
export async function runTests(config, { root, run = runCommand } = {}) {
  const command = (config && config.test && config.test.command) || '';
  const base = { stage: 'tests', ok: false, blocked: false, reason: '', command: '', code: null, ms: 0, findings: [] };

  if (!command) {
    return {
      ...base,
      blocked: true,
      reason: RULES.noTestCommand,
      findings: [{ file: '', line: 0, rule: RULES.noTestCommand, data: {} }]
    };
  }

  const { code, ms } = await run(command, { cwd: root });
  return { ...base, ok: code === 0, command, code, ms };
}
