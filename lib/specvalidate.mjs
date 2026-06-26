import { requirements } from './qa.mjs';

const EARS_RE = /\b(WHEN|IF|WHILE|WHERE)\b[\s\S]*?\bTHE SYSTEM SHALL\b/i;

function lines(text) {
  return String(text || '').split(/\r?\n/);
}

export function validateGeneratedSpec(files = {}) {
  const issues = [];
  const spec = files['spec.md'] || '';
  const plan = files['plan.md'] || '';
  const tasks = files['tasks.md'] || '';
  const reqs = requirements(spec);
  const ids = reqs.map((r) => r.id);
  const idSet = new Set(ids);

  if (!spec.trim()) issues.push({ level: 'error', code: 'spec-empty', message: 'spec.md está vacío.' });
  if (!plan.trim()) issues.push({ level: 'warn', code: 'plan-empty', message: 'plan.md está vacío.' });
  if (!tasks.trim()) issues.push({ level: 'warn', code: 'tasks-empty', message: 'tasks.md está vacío.' });
  if (!reqs.length) issues.push({ level: 'error', code: 'no-requirements', message: 'No se detectaron requisitos R# en spec.md.' });

  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) issues.push({ level: 'error', code: 'duplicate-requirement', message: `Requisito duplicado: ${id}.` });
    seen.add(id);
  }

  for (const req of reqs) {
    if (!EARS_RE.test(req.text)) {
      issues.push({ level: 'warn', code: 'non-ears', message: `${req.id} no parece estar escrito en EARS testable.` });
    }
  }

  const mentionedInTasks = new Set([...tasks.matchAll(/\bR\d+\b/gi)].map((m) => m[0].toUpperCase()));
  for (const id of mentionedInTasks) {
    if (!idSet.has(id)) issues.push({ level: 'error', code: 'unknown-task-ref', message: `tasks.md referencia ${id}, pero no existe en spec.md.` });
  }
  for (const id of ids) {
    if (tasks.trim() && !mentionedInTasks.has(id)) issues.push({ level: 'warn', code: 'missing-task-ref', message: `tasks.md no referencia ${id}.` });
  }

  const clarificationCount = lines(spec + '\n' + plan + '\n' + tasks).filter((line) => line.includes('[NEEDS CLARIFICATION')).length;
  if (clarificationCount) {
    issues.push({ level: 'warn', code: 'needs-clarification', message: `Hay ${clarificationCount} aclaración(es) pendiente(s) antes de implementar.` });
  }

  return issues;
}

export function summarizeValidation(issues) {
  const errors = issues.filter((i) => i.level === 'error').length;
  const warnings = issues.filter((i) => i.level === 'warn').length;
  return { errors, warnings, ok: errors === 0 };
}
