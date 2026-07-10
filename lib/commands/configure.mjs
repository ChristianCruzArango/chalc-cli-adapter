// Comandos de configuración del catálogo: `chalc configure` y `chalc install`,
// con sus wizards de reglas/skills/MCP y el cableado skill↔regla.

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { t } from '../i18n.mjs';
import { assertSafeId } from '../ids.mjs';
import { installSkill } from '../install.mjs';
import { CATALOG, RULES_DIR, c, cleanPath, flags, force, allowExternalExec, installSource, interactive } from './context.mjs';
import { loadJsonDir, loadRules, writeJson, slugifyId } from './catalogstore.mjs';
import { makePrompter } from './prompter.mjs';

// Cablea un skill a una regla (esto es lo que llena el sistema con el uso).
export async function addSkillToRule(ruleId, skillId) {
  ruleId = assertSafeId(ruleId, 'rule id');
  skillId = assertSafeId(skillId, 'skill id');
  const file = join(RULES_DIR, `${ruleId}.json`);
  let rule;
  if (existsSync(file)) rule = JSON.parse(await readFile(file, 'utf8'));
  else rule = { id: ruleId, name: ruleId, ...(ruleId === 'global' ? { always: true } : {}), skills: [], mcp: [], optionalMcp: [] };
  rule.skills = rule.skills || [];
  if (!rule.skills.includes(skillId)) rule.skills.push(skillId);
  await writeFile(file, JSON.stringify(rule, null, 2) + '\n');
}

export async function chooseRule(prompter, q = t('ruleAddToWhich')) {
  const rules = await loadRules();
  const term = (await prompter.text(t('ruleSearchQ'))).toLowerCase();
  const filtered = rules.filter((r) => {
    const hay = `${r.id} ${r.name || ''} ${r.language || ''}`.toLowerCase();
    return !term || hay.includes(term);
  });
  const options = filtered.length ? filtered : rules;
  if (!filtered.length) console.log(c.yellow(t('ruleNoResults')));
  const idx = await prompter.select(q, options.map((r) => ({
    label: `${r.id} — ${r.name || r.id}${r.language ? ` · ${r.language}` : ''}`,
    value: r.id
  })), 0);
  return options[idx];
}

export async function addMcpToRule(ruleId, mcpId, optional = false) {
  ruleId = assertSafeId(ruleId, 'rule id');
  mcpId = assertSafeId(mcpId, 'MCP id');
  const file = join(RULES_DIR, `${ruleId}.json`);
  if (!existsSync(file)) throw new Error(t('ruleNotExists', ruleId));
  const rule = JSON.parse(await readFile(file, 'utf8'));
  const key = optional ? 'optionalMcp' : 'mcp';
  rule[key] = rule[key] || [];
  rule.mcp = rule.mcp || [];
  rule.optionalMcp = rule.optionalMcp || [];
  if (!rule[key].includes(mcpId)) rule[key].push(mcpId);
  if (!optional) rule.optionalMcp = rule.optionalMcp.filter((id) => id !== mcpId);
  await writeJson(file, rule);
}

export async function addExistingSkillToRule(prompter) {
  const skillDirs = existsSync(join(CATALOG, 'skills'))
    ? (await readdir(join(CATALOG, 'skills'), { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort()
    : [];
  if (!skillDirs.length) throw new Error(t('skillNoneInCatalog'));
  const term = (await prompter.text(t('skillSearchQ'))).toLowerCase();
  const filtered = skillDirs.filter((id) => !term || id.toLowerCase().includes(term));
  const options = filtered.length ? filtered : skillDirs;
  if (!filtered.length) console.log(c.yellow(t('skillNoResults')));
  const skillId = options[await prompter.select(t('skillWhichToAddQ'), options.map((id) => ({ label: id })), 0)];
  const rule = await chooseRule(prompter);
  await addSkillToRule(rule.id, skillId);
  console.log(c.green(t('skillAddedToRule', skillId, rule.id)));
}

export async function createRuleWizard(prompter) {
  let id = slugifyId(await prompter.text(t('ruleIdQ')));
  while (!id) id = slugifyId(await prompter.text(t('idRequired')));
  const file = join(RULES_DIR, `${id}.json`);
  if (existsSync(file) && !await prompter.yesno(t('ruleExistsReplace', id), false)) return null;

  const name = await prompter.text(t('ruleVisibleNameQ', id)) || id;
  const language = await prompter.text(t('ruleLanguageQ'));
  const detectKindOptions = [
    { label: t('ruleDetectFiles'), value: 'anyFile' },
    { label: t('ruleDetectGlobs'), value: 'anyGlob' },
    { label: t('ruleDetectDeps'), value: 'anyDependency' }
  ];
  const detectKind = detectKindOptions[await prompter.select(t('ruleSignalQ'), detectKindOptions, 0)].value;
  const raw = await prompter.text(t('ruleValuesQ', detectKind));
  const values = raw.split(',').map((x) => x.trim()).filter(Boolean);
  if (!values.length) throw new Error(t('ruleNeedsSignal'));

  const rule = {
    id,
    name,
    ...(language ? { language } : {}),
    detect: { [detectKind]: values },
    skills: [],
    mcp: [],
    optionalMcp: []
  };
  await writeJson(file, rule);
  console.log(c.green(t('ruleCreated', id)));
  return rule;
}

export async function installSkillWizard(prompter) {
  const source = cleanPath(await prompter.text(t('skillSourceQ')));
  if (!source) return;
  const installed = await installSkill({ source, CATALOG, prompter, force, allowExternalExec, log: (m) => console.log(c.dim('  ' + m)) });
  if (!installed.length) {
    console.log(c.dim(t('skillNoneInstalled')));
    return;
  }
  console.log(c.green(t('skillsInstalled', installed.join(', '))));
  for (const id of installed) {
    if (await prompter.yesno(t('skillAddNowQ', id), true)) {
      const rule = await chooseRule(prompter, t('skillTargetRule', id));
      await addSkillToRule(rule.id, id);
      console.log(c.green(`  ✓ ${id} → ${rule.id}`));
    }
  }
}

export async function createMcpWizard(prompter) {
  let id = slugifyId(await prompter.text(t('mcpIdQ')));
  while (!id) id = slugifyId(await prompter.text(t('idRequired')));
  const file = join(CATALOG, 'mcp', `${id}.json`);
  if (existsSync(file) && !await prompter.yesno(t('mcpExistsReplace', id), false)) return null;

  const description = await prompter.text(t('mcpDescQ'));
  const command = await prompter.text(t('mcpCommandQ'));
  if (!command) throw new Error(t('mcpNeedsCommand'));
  const argsRaw = await prompter.text(t('mcpArgsQ'));
  const requiresSecret = await prompter.yesno(t('mcpSecretsQ'), false);
  const server = {
    command,
    ...(argsRaw ? { args: argsRaw.split(/\s+/).filter(Boolean) } : {})
  };
  if (requiresSecret) {
    const envName = await prompter.text(t('mcpEnvNameQ'));
    if (envName) {
      // Los secretos se guardan POR REFERENCIA (${VAR}), nunca el valor: catalog/mcp/<id>.json se
      // proyecta al .mcp.json de cada proyecto equipado, que suele commitearse. deepSub deja las
      // referencias desconocidas intactas, así que ${VAR} llega tal cual y se resuelve del entorno.
      if (await prompter.yesno(t('mcpEnvIsSecretQ'), true)) {
        server.env = { [envName]: `\${${envName}}` };
        console.log(c.dim('  ' + t('mcpSecretByRef', envName)));
      } else {
        const envValue = await prompter.text(t('mcpEnvValueQ'));
        if (envValue) server.env = { [envName]: envValue };
      }
    }
  }
  const mcp = {
    id,
    kind: command === 'npx' ? 'npx' : 'stdio',
    description,
    requiresSecret,
    server
  };
  await writeJson(file, mcp);
  console.log(c.green(t('mcpRegistered', id)));
  return mcp;
}

export async function addMcpWizard(prompter) {
  const mcps = existsSync(join(CATALOG, 'mcp'))
    ? (await readdir(join(CATALOG, 'mcp'))).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort()
    : [];
  if (!mcps.length) throw new Error(t('mcpNoneInCatalog'));
  const term = (await prompter.text(t('mcpSearchQ'))).toLowerCase();
  const filtered = mcps.filter((id) => !term || id.toLowerCase().includes(term));
  const options = filtered.length ? filtered : mcps;
  if (!filtered.length) console.log(c.yellow(t('mcpNoResults')));
  const mcpId = options[await prompter.select(t('mcpWhichToAddQ'), options.map((id) => ({ label: id })), 0)];
  const rule = await chooseRule(prompter, t('cfgMcpTargetRule', mcpId));
  const optional = await prompter.yesno(t('cfgAsOptionalQ'), true);
  await addMcpToRule(rule.id, mcpId, optional);
  console.log(c.green(t('mcpAddedToRule', mcpId, optional ? 'optionalMcp' : 'mcp', rule.id)));
}

// Pregunta a qué stack pertenece un skill y lo cablea a la regla. Devuelve el ruleId o null.
export async function associate(prompter, rules, skillId, stackFlag) {
  let ruleId = stackFlag || null;
  if (prompter) {
    const opts = [
      ...rules.filter((r) => !r.always).map((r) => ({ label: `${r.name}${r.language ? ' · ' + r.language : ''}`, value: r.id })),
      { label: t('globalOpt'), value: 'global' },
      { label: t('noneOpt'), value: null }
    ];
    ruleId = opts[await prompter.select(t('associateQ', skillId), opts, 0)].value;
  }
  if (ruleId) {
    await addSkillToRule(ruleId, skillId);
    console.log(c.green('  ✓ ' + t('wiredTo', skillId, ruleId)));
  } else {
    console.log(c.dim('  · ' + t('catalogOnly', skillId)));
  }
  return ruleId;
}

// ---------- comando: chalc install ----------
export async function runInstall() {
  if (!installSource) throw new Error(t('installUsage'));
  const source = cleanPath(installSource);
  console.log('\n' + c.bold('⚙️  chalc install') + c.dim(`  ·  ${source}`) + '\n');
  const prompter = interactive ? makePrompter() : null;
  const installed = await installSkill({ source, CATALOG, prompter, force, allowExternalExec, log: (m) => console.log(c.dim('  ' + m)) });
  console.log(c.green('✓ ' + t('inCatalog', installed.length, installed.join(', '))) + '\n');
  const rules = await loadJsonDir(RULES_DIR);
  for (const id of installed) await associate(prompter, rules, id, flags.stack && String(flags.stack));
  if (prompter) prompter.close();
  console.log('\n' + c.dim(t('installFromTo') + '\n'));
}

// ---------- comando: chalc configure ----------
export async function runConfigure() {
  console.log('\n' + c.bold('⚙️  chalc configure') + c.dim('  ·  ' + t('cfgSubtitle')) + '\n');
  if (!interactive) throw new Error(t('cfgInteractiveOnly'));
  const prompter = makePrompter();
  const actions = [
    { label: t('cfgActionCreateRule'), value: 'rule' },
    { label: t('cfgActionInstallSkill'), value: 'install-skill' },
    { label: t('cfgActionAddSkill'), value: 'add-skill' },
    { label: t('cfgActionCreateMcp'), value: 'create-mcp' },
    { label: t('cfgActionAddMcp'), value: 'add-mcp' },
    { label: t('cfgActionExit'), value: 'exit' }
  ];

  while (true) {
    const action = actions[await prompter.select(t('cfgWhatQ'), actions, 0)].value;
    try {
      if (action === 'exit') break;
      if (action === 'rule') await createRuleWizard(prompter);
      if (action === 'install-skill') await installSkillWizard(prompter);
      if (action === 'add-skill') await addExistingSkillToRule(prompter);
      if (action === 'create-mcp') {
        const mcp = await createMcpWizard(prompter);
        if (mcp && await prompter.yesno(t('cfgAddMcpNowQ', mcp.id), true)) {
          const rule = await chooseRule(prompter, t('cfgMcpTargetRule', mcp.id));
          const optional = await prompter.yesno(t('cfgAsOptionalQ'), true);
          await addMcpToRule(rule.id, mcp.id, optional);
          console.log(c.green(`  ✓ ${mcp.id} → ${rule.id}`));
        }
      }
      if (action === 'add-mcp') await addMcpWizard(prompter);
    } catch (e) {
      console.log(c.red('  ✗ ' + e.message));
    }
    if (!await prompter.yesno(t('cfgMoreQ'), true)) break;
  }
  prompter.close();
  console.log(c.dim('\n' + t('cfgDone') + '\n'));
}
