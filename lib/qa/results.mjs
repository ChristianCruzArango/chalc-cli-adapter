// lib/qa/results.mjs — informes del QA agéntico: resultados por R#, plan de reparación y su lectura.

import { redactSensitiveText } from '../redact.mjs';
import { F } from './common.mjs';

// Reporte trazable: una fila por R# con su veredicto y la evidencia observada.
export function buildResultsMarkdown(specId, { surface, baseUrl, result, evidencePaths = [] }) {
  const f = F();
  const header = [
    f.resultsTitle(specId),
    '',
    f.surfaceL(surface),
    f.baseUrlL(baseUrl),
    f.stepsL(result.steps?.length ?? 0)
  ];
  if (result.ccr) header.push(f.ccrL(result.ccr.entries, result.ccr.charsSaved));
  if (result.error) header.push(f.noteL(result.error));
  if (evidencePaths.length) header.push(f.evidenceL(evidencePaths.map((p) => `\`${p}\``).join(', ')));
  const table = [
    '',
    f.tableHead,
    '|---|---|---|',
    ...result.verdicts.map((v) => `| ${v.id} | ${v.status} | ${redactSensitiveText(v.evidence || '').replaceAll('|', '\\|')} |`),
    ''
  ];
  return [...header, ...table].join('\n');
}

export function buildRepairPlanMarkdown(specId, { result, requirementTexts = {}, generatedAt = new Date().toISOString() }) {
  const f = F();
  const actionable = (result?.verdicts || []).filter((v) => ['FAIL', 'BLOCKED'].includes(v.status));
  const lines = [
    f.repairTitle(specId),
    '',
    f.generatedL(generatedAt),
    f.sourceL,
    '',
    f.scopeH,
    '',
    actionable.length ? f.scopeActionable : f.scopeNone,
    '',
    f.tasksH,
    ''
  ];
  if (!actionable.length) {
    lines.push(f.taskNone);
    return lines.join('\n') + '\n';
  }
  for (const item of actionable) {
    const text = requirementTexts[item.id] ? ` — ${requirementTexts[item.id]}` : '';
    lines.push(
      `- [ ] ${item.id}${text}`,
      f.taskStatus(item.status),
      f.taskEvidence(redactSensitiveText(item.evidence || f.noEvidence).replace(/\s+/g, ' ').trim()),
      f.taskWriteTest,
      f.taskFix,
      f.taskRerun
    );
  }
  return lines.join('\n') + '\n';
}

export function parseResultsMarkdown(markdown) {
  const verdicts = [];
  for (const line of String(markdown || '').split(/\r?\n/)) {
    const m = line.match(/^\|\s*(R\d+)\s*\|\s*(PASS|FAIL|BLOCKED|NOT_APPLICABLE)\s*\|\s*(.*?)\s*\|$/i);
    if (!m) continue;
    verdicts.push({ id: m[1].toUpperCase(), status: m[2].toUpperCase(), evidence: m[3].replace(/\\\|/g, '|').trim() });
  }
  return { verdicts, steps: [] };
}
