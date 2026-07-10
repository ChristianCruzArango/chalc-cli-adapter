export function deliverQaFlagPatch() {
  return { plan: true, up: true, agent: true, 'repair-plan': true, 'skip-qa-inputs': true };
}

export function actionableVerdicts(result) {
  return (result?.verdicts || []).filter((v) => ['FAIL', 'BLOCKED'].includes(String(v.status || '').toUpperCase()));
}

function quoteArg(value) {
  const s = String(value || '');
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(s) ? s : JSON.stringify(s);
}

export function buildDeliverRerunCommand({ projectPath = '.', specId, env, url, surface, allowExec = false } = {}) {
  const args = ['chalc', 'deliver', quoteArg(projectPath)];
  if (specId) args.push('--spec', quoteArg(specId));
  if (env) args.push('--env', quoteArg(env));
  if (url) args.push('--url', quoteArg(url));
  if (surface) args.push('--surface', quoteArg(surface));
  args.push('--rerun');
  if (allowExec) args.push('--allow-exec');
  return args.join(' ');
}
