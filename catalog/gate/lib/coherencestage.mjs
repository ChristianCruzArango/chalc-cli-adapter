// coherencestage.mjs — la etapa `coherence` del portón (spec 024, R17). Responsabilidad ÚNICA: convertir los
// hechos de la carpeta activa en una etapa. Razón de cambio: qué bloquea antes de tests y mutación.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.

import { RULES } from './rules.mjs';
import { specFacts } from './specfacts.mjs';

// Coherente pero sin sello vigente: falta lo único que no puede hacer el asistente.
const notApproved = (dir) => [{ file: dir, line: 1, rule: RULES.specNotApproved, data: { dir } }];

/** La etapa, o null si el repo no tiene ninguna carpeta de spec (sin SDD no hay contra qué comprobar). */
export async function coherenceStage(root, specDir) {
  const started = Date.now();
  const facts = await specFacts(root, specDir);
  if (!facts.dir && facts.problem !== 'active-spec-invalid') return null;
  const findings = facts.problems.length || facts.approved ? facts.problems : notApproved(facts.dir);
  const failed = findings.length > 0;
  return { stage: 'coherence', ok: !failed, blocked: failed, reason: failed ? 'coherence' : '', command: '', code: null, ms: Date.now() - started, findings };
}
