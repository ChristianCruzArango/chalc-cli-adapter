// build.mjs — etapa de compilación (spec 018, R1, R2). Responsabilidad ÚNICA: compilar el repo con su
// propio comando y decir si compila. Razón de cambio: cómo se ejecuta y se juzga la compilación.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// Por qué existe: en el E2E de la spec 017, código que `tsc` rechazaba pasó el portón y a los tres roles.
// Los tests corrían con un runner que tolera lo que el compilador no, y nadie compiló. Un repo cuyo código
// no compila no tiene tarea que cerrar, por verde que salga su suite.
//
// Sin comando la etapa NO APLICA (un JS sin build ni tsconfig no tiene nada que compilar), a diferencia
// de los tests, que bloquean: compilar es una garantía extra, no la base. Con la herramienta ausente
// bloquea antes de ejecutar nada, como la mutación: `npx` descargaría lo que no encuentra.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { runCommand } from './run.mjs';
import { RULES } from './rules.mjs';

// Códigos de "no encontré el ejecutable": 127 en sh, 9009 en cmd.exe.
const NOT_INSTALLED = new Set([127, 9009]);

const BASE = { stage: 'build', ok: false, blocked: false, reason: '', command: '', code: null, ms: 0, findings: [] };
const finding = (rule, data) => ({ file: '', line: 0, rule, data });
const notInstalled = (cfg, over = {}) => ({
  ...BASE, ...over, blocked: true, reason: RULES.buildNotInstalled,
  findings: [finding(RULES.buildNotInstalled, { tool: cfg.command, install: cfg.install || '' })]
});

/** Compila con `build.command`. `run` va inyectado para probar las decisiones sin ejecutar nada. */
export async function runBuild(config, { root, run = runCommand } = {}) {
  const cfg = config?.build || {};
  if (!cfg.command) return { ...BASE, ok: true, skipped: true, reason: 'not-applicable' };
  if (cfg.probe && !existsSync(join(root, cfg.probe))) return notInstalled(cfg);

  const { code, ms } = await run(cfg.command, { cwd: root });
  const ran = { command: cfg.command, code, ms };
  if (NOT_INSTALLED.has(code)) return notInstalled(cfg, ran);
  if (code === 0) return { ...BASE, ...ran, ok: true };
  return { ...BASE, ...ran, findings: [finding(RULES.buildFailed, { command: cfg.command, code })] };
}
