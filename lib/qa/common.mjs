// lib/qa/common.mjs — lo que comparten el agente de QA y sus informes: textos por idioma y la
// redacción de las observaciones.

import { lang } from '../i18n.mjs';
import { contentLang } from '../contentlang.mjs';
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
    taskRerun: '  - Reejecutar `chalc qa ... --agent` y confirmar que el requisito pasa.',
    // test-plan.md
    planTitle: (id) => `# Plan QA — ${id}`,
    planFromSpec: '> Generado desde `spec.md`. Este plan no añade comportamiento fuera de la spec.',
    planResolveFirst: '> Antes de automatizar, resuelve cualquier duda funcional y prepara datos de prueba.',
    planLaunchL: (l) => `**Entorno de arranque:** ${l}`,
    planLaunchPending: '_pendiente: elige uno con `--env`_',
    planTraceH: '## Trazabilidad',
    planTableHead: '| Requisito | Criterio de la spec | Estrategia QA | Estado |',
    planStrategyPending: 'Pendiente: definir flujo visible/API pública',
    planNoRequirements: '| — | No se detectaron requisitos R# en la spec. | Corregir spec antes de probar. | BLOCKED |',
    planQuestionsH: '## Preguntas QA',
    planQData: '- [ ] Datos de prueba y credenciales QA disponibles.',
    planQUrl: '- [ ] URL/base URL del entorno QA definida.',
    planQObservable: '- [ ] La spec describe resultados observables para cada R#.',
    // comentarios de los spec Playwright generados
    testsGenerated: (id) => `// Generado por chalc qa desde specs/${id}/spec.md.`,
    testsMissing: (id) => `// Faltan ruta o resultado observable en specs/${id}/qa/inputs.json.`,
    replayGenerated: (id) => `// Generado por chalc qa --agent: réplica de lo verificado en vivo para ${id}. Un test por requisito.`,
    replayNoSteps: (id) => `${id}: el agente no ejecutó pasos de navegador reproducibles`,
    replayInspect: '// inspect (sin aserción)',
    replayUnknownOp: (op) => `// op no reproducible: ${op}`
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
    taskRerun: '  - Re-run `chalc qa ... --agent` and confirm the requirement passes.',
    // test-plan.md
    planTitle: (id) => `# QA plan — ${id}`,
    planFromSpec: '> Generated from `spec.md`. This plan adds no behaviour beyond the spec.',
    planResolveFirst: '> Before automating, resolve any functional doubt and prepare test data.',
    planLaunchL: (l) => `**Launch environment:** ${l}`,
    planLaunchPending: '_to do: pick one with `--env`_',
    planTraceH: '## Traceability',
    planTableHead: '| Requirement | Spec criterion | QA strategy | Status |',
    planStrategyPending: 'To do: define the visible flow/public API',
    planNoRequirements: '| — | No R# requirements were found in the spec. | Fix the spec before testing. | BLOCKED |',
    planQuestionsH: '## QA questions',
    planQData: '- [ ] Test data and QA credentials available.',
    planQUrl: '- [ ] URL/base URL of the QA environment defined.',
    planQObservable: '- [ ] The spec describes observable results for each R#.',
    // comentarios de los spec Playwright generados
    testsGenerated: (id) => `// Generated by chalc qa from specs/${id}/spec.md.`,
    testsMissing: (id) => `// Missing path or observable result in specs/${id}/qa/inputs.json.`,
    replayGenerated: (id) => `// Generated by chalc qa --agent: replay of what was verified live for ${id}. One test per requirement.`,
    replayNoSteps: (id) => `${id}: the agent did not run reproducible browser steps`,
    replayInspect: '// inspect (no assertion)',
    replayUnknownOp: (op) => `// op not reproducible: ${op}`
  }
};
export const F = () => QA[lang] || QA.es;
// Los ARTEFACTOS que se escriben en el proyecto (plan, specs Playwright) van en el idioma del contenido:
// el de la spec si se conoce y, si no, el de la interfaz.
export const qaText = (specLang = '') => QA[contentLang(specLang)];

// La captura se conserva solo para el artefacto local de evidencia; se excluye del prompt abajo.
export function redactObservation(value) {
  return redactObservationValue(value, { preserveScreenshots: true });
}
