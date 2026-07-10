// Comando `chalc inspect`: explica qué detecta y por qué, sin escribir nada.

import { existsSync } from 'node:fs';
import { t } from '../i18n.mjs';
import { detectContext, formatDetect, ruleReasons } from '../detect.mjs';
import { RULES_DIR, c, disp, flags, interactive, projectPath } from './context.mjs';
import { formatList, loadJsonDir, loadMethods, loadTargets } from './catalogstore.mjs';
import { makePrompter } from './prompter.mjs';

// ---------- comando: chalc inspect ----------
export async function runInspect() {
  console.log('\n' + c.bold('⚙️  chalc inspect') + c.dim(`  ·  ${disp(projectPath)}`) + '\n');
  if (!existsSync(projectPath)) { console.error(c.red(`✗ La ruta no existe: ${disp(projectPath)}`)); process.exit(1); }

  const ctx = await detectContext(projectPath);
  const rules = await loadJsonDir(RULES_DIR);
  const inspectedRules = rules.map((rule) => ({ rule, reasons: ruleReasons(rule, ctx) }));
  const matches = inspectedRules.filter((x) => x.reasons.length);
  const misses = inspectedRules.filter((x) => !x.reasons.length && !x.rule.always);
  const stacks = matches.map((x) => x.rule).filter((r) => !r.always);
  const skills = [...new Set(matches.flatMap((x) => x.rule.skills || []))];
  const mcpIds = [...new Set(matches.flatMap((x) => x.rule.mcp || []))];
  const optionalMcpIds = [...new Set(matches.flatMap((x) => x.rule.optionalMcp || []))].filter((id) => !mcpIds.includes(id));
  const methods = await loadMethods();
  const targets = await loadTargets();

  if (stacks.length) {
    const langs = [...new Set(stacks.map((r) => r.language).filter(Boolean))];
    console.log(c.green('✓ ') + c.bold(t('inspectStackDetected')) + stacks.map((r) => r.name).join(' + ') + (langs.length ? c.dim(`  ·  ${langs.join(', ')}`) : ''));
  } else {
    console.log(c.yellow(t('inspectNoStack')));
  }

  const prompter = interactive ? makePrompter() : null;
  const showMatched = !prompter || await prompter.yesno(t('inspectShowMatchedQ'), true);
  const showPlan = !prompter || await prompter.yesno(t('inspectShowPlanQ'), true);
  const showMisses = !prompter || await prompter.yesno(t('inspectShowMissesQ'), false);
  const showCatalog = !prompter || await prompter.yesno(t('inspectShowCatalogQ'), true);

  if (showMatched) {
    console.log('\n' + c.bold(t('inspectMatchedHdr')));
    for (const { rule, reasons } of matches) {
      console.log(`  ${c.green('✓')} ${rule.id} ${c.dim(`(${rule.name || rule.id})`)}`);
      console.log(`    ${t('inspectLblSignals').padEnd(8)}: ${formatList(reasons)}`);
      console.log(`    skills  : ${formatList(rule.skills || [])}`);
      console.log(`    mcp     : ${formatList(rule.mcp || [])}`);
      if (rule.optionalMcp?.length) console.log(`    ${t('inspectLblOptional').padEnd(8)}: ${formatList(rule.optionalMcp)}`);
    }
    if (!matches.length) console.log(`  ${c.dim(t('inspectNoRuleMatches'))}`);
  }

  if (showPlan) {
    console.log('\n' + c.bold(t('inspectPlanHdr')));
    console.log(`  skills  : ${formatList(skills)}`);
    console.log(`  mcp     : ${formatList(mcpIds)}`);
    console.log(`  ${t('inspectLblOptional').padEnd(8)}: ${formatList(optionalMcpIds)}`);
    console.log(`  target  : ${flags.target || 'claude'}`);
  }

  if (showMisses) {
    console.log('\n' + c.bold(t('inspectMissesHdr')));
    for (const { rule } of misses) {
      console.log(`  ${c.dim('·')} ${rule.id} ${c.dim(`${t('inspectExpected')} ${formatDetect(rule)}`)}`);
    }
    if (!misses.length) console.log(`  ${c.dim(t('inspectAllApply'))}`);
  }

  if (showCatalog) {
    console.log('\n' + c.bold(t('inspectCatalogHdr')));
    console.log(`  ${t('inspectLblMethods').padEnd(8)}: ${formatList(methods.map((m) => `${m.id} (${m.modes.map((mode) => mode.id).join('/')})`))}`);
    console.log(`  targets : ${formatList(targets.map((tg) => `${tg.id} (${tg.label})`))}`);
  }
  if (prompter) prompter.close();
  console.log('');
}
