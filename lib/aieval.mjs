import { parseDelimited } from './specgen.mjs';
import { parseAgentMessage, normalizeVerdicts } from './qaagent.mjs';
import { validateGeneratedSpec } from './specvalidate.mjs';
import { t } from './i18n.mjs';

function pass(name) {
  return { name, ok: true };
}

function fail(name, error) {
  return { name, ok: false, error: String(error?.message || error) };
}

export function runLocalAiEvals() {
  const checks = [];
  const run = (name, fn) => {
    try { checks.push(fn() || pass(name)); }
    catch (e) { checks.push(fail(name, e)); }
  };

  run('spec parser preserves delimited files', () => {
    const parsed = parseDelimited('===FEATURE===\nlogin\n===SPEC===\n**R1** — WHEN x THE SYSTEM SHALL y\n===PLAN===\nplan\n===TASKS===\n- [ ] R1 test');
    if (parsed.feature !== 'login') throw new Error(t('evalNotParsed', 'feature'));
    if (!parsed.files['spec.md'].includes('R1')) throw new Error(t('evalNotParsed', 'spec.md'));
    return pass('spec parser preserves delimited files');
  });

  run('spec validation rejects invented task refs', () => {
    const issues = validateGeneratedSpec({
      'spec.md': '**R1** — WHEN the user logs in THE SYSTEM SHALL show the home page.',
      'plan.md': 'Plan',
      'tasks.md': '- [ ] Add test for R2'
    });
    if (!issues.some((i) => i.code === 'unknown-task-ref')) throw new Error(t('evalMissedUnknownRef'));
    return pass('spec validation rejects invented task refs');
  });

  run('qa parser accepts fenced json only as object', () => {
    const msg = parseAgentMessage('```json\n{"done":true,"verdicts":[]}\n```');
    if (!msg.done) throw new Error(t('evalNotParsed', 'JSON'));
    return pass('qa parser accepts fenced json only as object');
  });

  run('qa verdict normalizer blocks missing evidence', () => {
    const out = normalizeVerdicts([{ id: 'R1', status: 'PASS', evidence: 'observed' }], ['R1', 'R2']);
    if (out[1].status !== 'BLOCKED') throw new Error(t('evalNotBlocked'));
    return pass('qa verdict normalizer blocks missing evidence');
  });

  return checks;
}
