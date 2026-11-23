// cicheck.mjs — `node .chalc/gate.mjs --ci` (spec 029, R11). Responsabilidad ÚNICA: comprobar, sin medir código,
// lo que tiene que ser verdad también fuera de la máquina del autor. Razón de cambio: qué se repite en CI.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// No corre tests ni mutación (eso es del CI del proyecto) y no escribe evidencia: no es una corrida del portón.
// Mira dos cosas que el autor podría haber torcido en local: las herramientas de `.chalc/` y que la spec activa
// sea coherente y lleve la aprobación de una persona.

import { coherenceStage } from './coherencestage.mjs';
import { loadConfig } from './config.mjs';
import { messageOf } from './i18n.mjs';
import { integrityProblems } from './integrity.mjs';
import { RULES } from './rules.mjs';

/** Los hallazgos de `root` en CI: [{ file, line, rule, data }]. */
export async function ciFindings(root, specDir) {
  const tooling = (await integrityProblems(root)).map(({ file, reason }) => ({ file, line: 1, rule: RULES.toolingAltered, data: { reason } }));
  const coherence = await coherenceStage(root, specDir);
  return [...tooling, ...(coherence ? coherence.findings : [])];
}

/** Corre la comprobación, escribe cada hallazgo con `write` y devuelve el código de salida (0 sin hallazgos). */
export async function ciCheck(root, write) {
  const { config } = await loadConfig(root);
  const lang = config.language || 'en';
  const findings = await ciFindings(root, config.spec?.dir || 'specs');
  for (const f of findings) write(`${f.file}:${f.line} — ${messageOf(f.rule, f.data, lang)}`);
  return findings.length ? 1 : 0;
}
