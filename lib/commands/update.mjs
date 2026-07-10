// lib/commands/update.mjs — `chalc update [id…] [--check] [--allow-exec]` (specs/003-chalc-update):
// sincroniza las skills instaladas con su fuente. La lógica vive en lib/update.mjs (testeable sin
// red); aquí solo presentación bilingüe y confirmación de ejecución externa (misma regla que install).

import { t } from '../i18n.mjs';
import { updateSkills } from '../update.mjs';
import { CATALOG, CHALC_ROOT, allowExternalExec, c, flags, interactive, positional } from './context.mjs';
import { makePrompter } from './prompter.mjs';

// Errores con código de razón propio → texto localizado; el resto muestra el detalle crudo (git, fs…).
function reasonText(r) {
  if (r.reason === 'needs-exec') return t('updateReasonNeedsExec');
  if (r.reason === 'source-unavailable') return t('updateReasonSourceUnavailable', r.error);
  if (r.reason === 'skill-missing') return t('updateReasonSkillMissing');
  return r.error || r.reason || 'error';
}

function line(r) {
  if (r.status === 'fresh') return c.dim(t('updateFresh', r.id));
  if (r.status === 'updated') return c.green(t('updateUpdated', r.id));
  if (r.status === 'outdated') return c.yellow(t('updateOutdated', r.id));
  if (r.status === 'unknown') return c.yellow(t('updateUnknown', r.id));
  return c.red(t('updateErr', r.id, reasonText(r)));
}

export async function runUpdate() {
  console.log('\n' + c.bold('⚙️  chalc update') + (flags.check ? c.dim(' (--check)') : '') + '\n');
  const prompter = interactive ? makePrompter() : null;
  try {
    const { results, builtins, lockWritten } = await updateSkills({
      catalog: CATALOG,
      chalcRoot: CHALC_ROOT,
      ids: positional.slice(1),
      check: !!flags.check,
      allowExternalExec,
      confirmExternal: prompter ? () => prompter.yesno(t('updateExternalQ'), false) : null,
      log: (m) => console.log(c.dim('  ' + m)),
      onSkill: (r) => console.log(line(r))
    });
    if (!results.length) {
      console.log(c.dim('  ' + t('updateNoInstalled', builtins.length)));
      return;
    }
    const count = (s) => results.filter((r) => r.status === s).length;
    console.log('\n  ' + t('updateSummary', count('updated'), count('fresh'), count('error') + count('unknown'), builtins.length));
    if (lockWritten) console.log('  ' + c.dim(t('updateLockNote')));
    if (count('updated')) console.log('  ' + c.cyan(t('updateApplyHint')));
    if (flags.check && count('outdated')) console.log('  ' + c.cyan(t('updateCheckHint')));
    console.log('');
  } finally {
    if (prompter) prompter.close();
  }
}
