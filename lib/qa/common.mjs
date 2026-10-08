// lib/qa/common.mjs — lo que comparten el agente de QA y sus informes: textos por idioma y la
// redacción de las observaciones.

import { lang } from '../i18n.mjs';
import { redactObservation as redactObservationValue } from '../redact.mjs';

// Marco bilingüe de los reportes y mensajes del agente. Sigue el patrón de DOC en lib/init.mjs:
// solo se localiza el FRAME (títulos/etiquetas); la evidencia y los datos del modelo quedan tal cual.
export const QA = {
  es: {
    noVerdict: 'El agente no emitió veredicto para este requisito.',
    invalidJson: 'El agente devolvió un JSON inválido.',
    stepsExhausted: (n) => `Se agotaron los ${n} pasos sin veredicto.`,
    resultsTitle: (id) => `# Resultados QA — ${id}`,
    surfaceL: (s) => `- Superficie: **${s}**`,
    baseUrlL: (u) => `- Base URL: ${u}`,
    stepsL: (n) => `- Pasos ejecutados: ${n}`,
    ccrL: (e, c) => `- CCR (compresión reversible): ${e} referencias, ~${c} caracteres diferidos`,
    noteL: (e) => `- Nota: ${e}`,
    evidenceL: (l) => `- Evidencias: ${l}`,
    tableHead: '| Requisito | Estado | Evidencia |',
    repairTitle: (id) => `# Plan de reparación — ${id}`,
    generatedL: (d) => `- Generado: ${d}`,
    sourceL: '- Fuente: `qa/results.md`',
    scopeH: '## Alcance',
    scopeActionable: 'Corregir solo los requisitos con evidencia FAIL/BLOCKED. No cambiar requisitos PASS salvo que una corrección lo exija.',
    scopeNone: 'No hay requisitos FAIL/BLOCKED en el último resultado QA.',
    tasksH: '## Tareas',
    taskNone: '- [ ] Mantener monitoreo; no se requiere reparación funcional.',
    taskStatus: (s) => `  - Estado QA: ${s}`,
    taskEvidence: (e) => `  - Evidencia: ${e}`,
    noEvidence: 'Sin evidencia registrada.',
    taskWriteTest: '  - Escribir o ajustar una prueba que reproduzca esta evidencia.',
    taskFix: '  - Implementar la mínima corrección necesaria.',
    taskRerun: '  - Reejecutar `chalc qa ... --agent` y confirmar que el requisito pasa.'
  },
  en: {
    noVerdict: 'The agent did not issue a verdict for this requirement.',
    invalidJson: 'The agent returned invalid JSON.',
    stepsExhausted: (n) => `Ran out of the ${n} steps without a verdict.`,
    resultsTitle: (id) => `# QA results — ${id}`,
    surfaceL: (s) => `- Surface: **${s}**`,
    baseUrlL: (u) => `- Base URL: ${u}`,
    stepsL: (n) => `- Steps run: ${n}`,
    ccrL: (e, c) => `- CCR (reversible compression): ${e} references, ~${c} chars deferred`,
    noteL: (e) => `- Note: ${e}`,
    evidenceL: (l) => `- Evidence: ${l}`,
    tableHead: '| Requirement | Status | Evidence |',
    repairTitle: (id) => `# Repair plan — ${id}`,
    generatedL: (d) => `- Generated: ${d}`,
    sourceL: '- Source: `qa/results.md`',
    scopeH: '## Scope',
    scopeActionable: 'Fix only the requirements with FAIL/BLOCKED evidence. Do not change PASS requirements unless a fix requires it.',
    scopeNone: 'There are no FAIL/BLOCKED requirements in the latest QA result.',
    tasksH: '## Tasks',
    taskNone: '- [ ] Keep monitoring; no functional repair is required.',
    taskStatus: (s) => `  - QA status: ${s}`,
    taskEvidence: (e) => `  - Evidence: ${e}`,
    noEvidence: 'No evidence recorded.',
    taskWriteTest: '  - Write or adjust a test that reproduces this evidence.',
    taskFix: '  - Implement the minimal necessary fix.',
    taskRerun: '  - Re-run `chalc qa ... --agent` and confirm the requirement passes.'
  }
};
export const F = () => QA[lang] || QA.es;

// La captura se conserva solo para el artefacto local de evidencia; se excluye del prompt abajo.
export function redactObservation(value) {
  return redactObservationValue(value, { preserveScreenshots: true });
}
