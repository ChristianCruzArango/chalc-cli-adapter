// Comando `chalc doctor`: valida reglas, catálogo, MCP, métodos y targets, con sus helpers de diagnóstico.

import { readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { t } from '../i18n.mjs';
import { CATALOG, CHALC_ROOT, METHODS_DIR, PROFILES_DIR, RULES_DIR, TARGETS_DIR, c, interactive } from './context.mjs';
import { loadJsonFiles } from './catalogstore.mjs';
import { skillIds as allSkillIds, userCatalog, userRulesDir } from '../userstore.mjs';
import { makePrompter } from './prompter.mjs';
import { exitCommand } from './exit.mjs';
import { AGENTS_DIR } from '../roles.mjs';
import { TOOLS_DIR } from '../tooltable.mjs';
import { catalogJsonIssues, duplicates, makeIssue, methodIssues, mcpFileIssues, profileIssues, ruleIssues, skillIssues, targetIssues } from './doctorchecks.mjs';

export { makeIssue, localizedFiles, duplicates, hasShellSyntax, mcpServerIssues } from './doctorchecks.mjs';

export function printIssues(title, issues) {
  console.log('\n' + c.bold(title));
  if (!issues.length) {
    console.log(`  ${c.green('✓')} ${t('doctorNoFindings')}`);
    return;
  }
  for (const issue of issues) {
    const mark = issue.level === 'error' ? c.red('✗') : c.yellow('!');
    console.log(`  ${mark} ${issue.area}: ${issue.message}`);
    if (issue.detail) console.log(c.dim(`    ${issue.detail}`));
  }
}

// ---------- comando: chalc doctor ----------
// Archivos del paquete con los del usuario encima: un id del usuario sustituye al del paquete.
const overlay = (base, mine) => {
  const ids = new Set(mine.filter((f) => f.json?.id).map((f) => f.json.id));
  return [...base.filter((f) => !ids.has(f.json?.id)), ...mine];
};

// Qué áreas revisar: en interactivo se pregunta; sin terminal, todas.
async function askScope() {
  const prompter = interactive ? makePrompter() : null;
  const scope = {
    rules: !prompter || await prompter.yesno(t('doctorAskRules'), true),
    catalog: !prompter || await prompter.yesno(t('doctorAskCatalog'), true),
    methods: !prompter || await prompter.yesno(t('doctorAskMethods'), true),
    targets: !prompter || await prompter.yesno(t('doctorAskTargets'), true),
    verbose: !prompter || await prompter.yesno(t('doctorAskVerbose'), false)
  };
  if (prompter) prompter.close();
  return scope;
}

// El paquete y la capa del usuario (~/.chalc): las dos se equipan, así que las dos se validan. Lo
// del usuario SUSTITUYE a lo del paquete con el mismo id: no es un duplicado.
async function loadCatalog() {
  const ruleFiles = overlay(await loadJsonFiles(RULES_DIR), await loadJsonFiles(userRulesDir()));
  const mcpFiles = overlay(await loadJsonFiles(join(CATALOG, 'mcp')), await loadJsonFiles(join(userCatalog(), 'mcp')));
  return {
    ruleFiles,
    rules: ruleFiles.filter((r) => r.json).map((r) => r.json),
    skillIds: allSkillIds(CATALOG),
    mcpFiles,
    mcpIds: mcpFiles.filter((m) => m.json?.id).map((m) => m.json.id),
    profileFiles: await loadJsonFiles(PROFILES_DIR)
  };
}

// Los JSON a validar de una carpeta del catálogo: `<sub>/<name>` por subcarpeta, o sus `*.json`.
async function jsonsIn(dir, name) {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return name
    ? entries.filter((e) => e.isDirectory()).map((e) => join(dir, e.name, name)).filter(existsSync)
    : entries.filter((e) => e.isFile() && e.name.endsWith('.json')).map((e) => join(dir, e.name));
}

async function collectIssues(scope, cat) {
  const issues = [];
  for (const id of duplicates(cat.rules.map((r) => r.id).filter(Boolean))) issues.push(makeIssue('error', 'rules', t('drDuplicateId', id)));
  for (const id of duplicates(cat.skillIds)) issues.push(makeIssue('error', 'skills', t('drDuplicateId', id)));
  for (const id of duplicates(cat.mcpIds)) issues.push(makeIssue('error', 'mcp', t('drDuplicateId', id)));
  if (scope.rules) issues.push(...ruleIssues(cat.ruleFiles, { rules: cat.rules, skillSet: new Set(cat.skillIds), mcpSet: new Set(cat.mcpIds) }));
  if (scope.catalog) issues.push(...await skillIssues(CATALOG, cat.skillIds), ...mcpFileIssues(cat.mcpFiles), ...profileIssues(cat.profileFiles),
    ...await catalogJsonIssues('agents', await jsonsIn(AGENTS_DIR, 'contract.json')), ...await catalogJsonIssues('tools', await jsonsIn(TOOLS_DIR)));
  if (scope.methods) issues.push(...await methodIssues(METHODS_DIR));
  if (scope.targets) issues.push(...await targetIssues(TARGETS_DIR));
  return issues;
}

async function printSummary(cat, errors, warnings) {
  console.log('\n' + c.bold(t('summary')));
  console.log(`  rules   : ${cat.ruleFiles.filter((r) => r.json).length}`);
  console.log(`  skills  : ${cat.skillIds.length}`);
  console.log(`  mcp     : ${cat.mcpIds.length}`);
  console.log(`  profiles: ${cat.profileFiles.filter((p) => p.json).length}`);
  console.log(`  targets : ${existsSync(TARGETS_DIR) ? (await readdir(TARGETS_DIR)).filter((f) => f.endsWith('.mjs')).length : 0}`);
  console.log(`  ${t('doctorErrors')} : ${errors.length}`);
  console.log(`  ${t('doctorWarnings')}  : ${warnings.length}\n`);
}

export async function runDoctor() {
  console.log('\n' + c.bold('⚙️  chalc doctor') + c.dim(`  ·  ${CHALC_ROOT}`) + '\n');
  const scope = await askScope();
  const cat = await loadCatalog();
  const issues = await collectIssues(scope, cat);
  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warn');
  printIssues(t('doctorDiagnosis'), scope.verbose ? issues : errors.concat(warnings.slice(0, 20)));
  if (!scope.verbose && warnings.length > 20) console.log(c.dim('  ' + t('doctorMoreWarnings', warnings.length - 20)));
  await printSummary(cat, errors, warnings);
  if (errors.length) exitCommand(1);
}
