import { requirements } from './qa.mjs';
import { t } from './i18n.mjs';

const EARS_RE = /\b(WHEN|IF|WHILE|WHERE)\b[\s\S]*?\bTHE SYSTEM SHALL\b/i;

function lines(text) {
  return String(text || '').split(/\r?\n/);
}

// Archivos vacíos, spec sin requisitos y spec sin conceptos.
function presenceIssues(spec, plan, tasks, reqs) {
  const issues = [];
  if (!spec.trim()) issues.push({ level: 'error', code: 'spec-empty', message: t('svEmpty', 'spec.md') });
  if (!plan.trim()) issues.push({ level: 'warn', code: 'plan-empty', message: t('svEmpty', 'plan.md') });
  if (!tasks.trim()) issues.push({ level: 'warn', code: 'tasks-empty', message: t('svEmpty', 'tasks.md') });
  if (!reqs.length) issues.push({ level: 'error', code: 'no-requirements', message: t('svNoRequirements') });
  // Sin conceptos la memoria cae al diccionario sobre el texto (spec 015, R10): no rompe nada, pero
  // entrega peor. Por eso es aviso y no error.
  if (spec.trim() && !/^\s*(?:conceptos|concepts)\s*:\s*\S/im.test(spec)) {
    issues.push({ level: 'warn', code: 'no-concepts', message: t('svNoConcepts') });
  }
  return issues;
}

// Requisitos duplicados y requisitos que no están escritos en EARS.
function requirementIssues(reqs) {
  const issues = [];
  const seen = new Set();
  for (const { id } of reqs) {
    if (seen.has(id)) issues.push({ level: 'error', code: 'duplicate-requirement', message: t('svDuplicate', id) });
    seen.add(id);
  }
  for (const req of reqs) {
    if (!EARS_RE.test(req.text)) {
      issues.push({ level: 'warn', code: 'non-ears', message: t('svNonEars', req.id) });
    }
  }
  return issues;
}

// Trazabilidad entre tasks.md y los requisitos del spec, en los dos sentidos.
function taskRefIssues(tasks, ids) {
  const issues = [];
  const idSet = new Set(ids);
  const mentionedInTasks = new Set([...tasks.matchAll(/\bR\d+\b/gi)].map((m) => m[0].toUpperCase()));
  for (const id of mentionedInTasks) {
    if (!idSet.has(id)) issues.push({ level: 'error', code: 'unknown-task-ref', message: t('svUnknownTaskRef', id) });
  }
  for (const id of ids) {
    if (tasks.trim() && !mentionedInTasks.has(id)) issues.push({ level: 'warn', code: 'missing-task-ref', message: t('svMissingTaskRef', id) });
  }
  return issues;
}

// Contenido que un documento malicioso intentaría colar en el plan o las tareas (S4): shell canalizado
// (`curl … | sh`), URLs a ejecutables y frases de inyección de prompt. Es aviso: el humano revisa.
const SUSPICIOUS = [
  /\|\s*(?:sudo\s+)?(?:sh|bash|zsh|iex|pwsh|powershell)\b/i,
  /https?:\/\/\S+\.(?:sh|bash|ps1|exe|bat|cmd|msi|py)\b/i,
  /\b(?:ignore|disregard|forget)\s+(?:all\s+)?(?:the\s+)?(?:previous|prior|above)\s+instructions\b/i,
  /\b(?:ignora|olvida)\s+(?:todas\s+)?las\s+instrucciones\s+(?:anteriores|previas)\b/i
];

function contentIssues(files) {
  return ['plan.md', 'tasks.md']
    .filter((name) => SUSPICIOUS.some((re) => re.test(files[name] || '')))
    .map((name) => ({ level: 'warn', code: 'suspicious-content', message: t('svSuspicious', name) }));
}

export function validateGeneratedSpec(files = {}) {
  const spec = files['spec.md'] || '';
  const plan = files['plan.md'] || '';
  const tasks = files['tasks.md'] || '';
  const reqs = requirements(spec);
  const issues = [
    ...presenceIssues(spec, plan, tasks, reqs),
    ...requirementIssues(reqs),
    ...taskRefIssues(tasks, reqs.map((r) => r.id)),
    ...contentIssues(files)
  ];
  const clarificationCount = lines(spec + '\n' + plan + '\n' + tasks).filter((line) => line.includes('[NEEDS CLARIFICATION')).length;
  if (clarificationCount) {
    issues.push({ level: 'warn', code: 'needs-clarification', message: t('svClarifications', clarificationCount) });
  }
  return issues;
}

export function summarizeValidation(issues) {
  const errors = issues.filter((i) => i.level === 'error').length;
  const warnings = issues.filter((i) => i.level === 'warn').length;
  return { errors, warnings, ok: errors === 0 };
}
