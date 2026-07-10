// Comando `chalc doctor`: valida reglas, catálogo, MCP, métodos y targets, con sus helpers de diagnóstico.

import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { t } from '../i18n.mjs';
import { isSafeId } from '../ids.mjs';
import { PROVIDERS } from '../ai.mjs';
import { CATALOG, CHALC_ROOT, METHODS_DIR, PROFILES_DIR, RULES_DIR, TARGETS_DIR, c, interactive } from './context.mjs';
import { loadJsonFiles } from './catalogstore.mjs';
import { makePrompter } from './prompter.mjs';

export function makeIssue(level, area, message, detail = '') {
  return { level, area, message, detail };
}

export function localizedFiles(value) {
  if (typeof value === 'string') return [value];
  if (value && typeof value === 'object' && !Array.isArray(value)) return Object.values(value).filter((v) => typeof v === 'string');
  return [];
}

export function duplicates(items) {
  const seen = new Set();
  const dupes = new Set();
  for (const item of items) {
    if (seen.has(item)) dupes.add(item);
    else seen.add(item);
  }
  return [...dupes];
}

export function hasShellSyntax(value) {
  return /[\s;&|`$<>]/.test(String(value || ''));
}

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
export async function runDoctor() {
  console.log('\n' + c.bold('⚙️  chalc doctor') + c.dim(`  ·  ${CHALC_ROOT}`) + '\n');
  const prompter = interactive ? makePrompter() : null;
  const runRules = !prompter || await prompter.yesno(t('doctorAskRules'), true);
  const runCatalog = !prompter || await prompter.yesno(t('doctorAskCatalog'), true);
  const runMethods = !prompter || await prompter.yesno(t('doctorAskMethods'), true);
  const runTargets = !prompter || await prompter.yesno(t('doctorAskTargets'), true);
  const verbose = !prompter || await prompter.yesno(t('doctorAskVerbose'), false);
  if (prompter) prompter.close();

  const issues = [];
  const ruleFiles = await loadJsonFiles(RULES_DIR);
  const rules = ruleFiles.filter((r) => r.json).map((r) => r.json);
  const skillIds = existsSync(join(CATALOG, 'skills'))
    ? (await readdir(join(CATALOG, 'skills'), { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name)
    : [];
  const skillSet = new Set(skillIds);
  const mcpFiles = await loadJsonFiles(join(CATALOG, 'mcp'));
  const profileFiles = await loadJsonFiles(PROFILES_DIR);
  const mcpIds = mcpFiles.filter((m) => m.json?.id).map((m) => m.json.id);
  const mcpSet = new Set(mcpIds);
  for (const id of duplicates(rules.map((r) => r.id).filter(Boolean))) issues.push(makeIssue('error', 'rules', `id duplicado "${id}"`));
  for (const id of duplicates(skillIds)) issues.push(makeIssue('error', 'skills', `id duplicado "${id}"`));
  for (const id of duplicates(mcpIds)) issues.push(makeIssue('error', 'mcp', `id duplicado "${id}"`));

  if (runRules) {
    for (const r of ruleFiles) {
      if (r.error) {
        issues.push(makeIssue('error', 'rules', `${r.file} no es JSON válido`, r.error.message));
        continue;
      }
      const rule = r.json;
      if (!rule.id) issues.push(makeIssue('error', 'rules', `${r.file} no tiene id`));
      else if (!isSafeId(rule.id)) issues.push(makeIssue('error', 'rules', `${r.file} tiene id inseguro "${rule.id}"`));
      if (rule.id && r.file !== `${rule.id}.json`) issues.push(makeIssue('warn', 'rules', `${r.file} no coincide con id "${rule.id}"`));
      if (!rule.name) issues.push(makeIssue('warn', 'rules', `${rule.id || r.file} no tiene name`));
      if (!rule.always && !rule.detect) issues.push(makeIssue('error', 'rules', `${rule.id || r.file} no tiene detect ni always`));
      const d = rule.detect || {};
      const detectKeys = ['anyDependency', 'anyFile', 'anyGlob', 'allDependency', 'allFile', 'allGlob'];
      for (const key of Object.keys(d)) {
        if (!detectKeys.includes(key)) issues.push(makeIssue('warn', 'rules', `${rule.id} usa detect.${key} no reconocido`));
        else if (!Array.isArray(d[key])) issues.push(makeIssue('error', 'rules', `${rule.id}.detect.${key} debe ser array`));
      }
      for (const key of ['skills', 'mcp', 'optionalMcp']) {
        if (rule[key] && !Array.isArray(rule[key])) issues.push(makeIssue('error', 'rules', `${rule.id}.${key} debe ser array`));
        if (Array.isArray(rule[key])) {
          for (const dupe of duplicates(rule[key])) issues.push(makeIssue('warn', 'rules', `${rule.id}.${key} contiene duplicado "${dupe}"`));
        }
      }
      if (Array.isArray(rule.implies)) {
        for (const implied of rule.implies) {
          if (!isSafeId(String(implied))) issues.push(makeIssue('error', 'rules', `${rule.id}.implies contiene id inseguro "${implied}"`));
          else if (!rules.some((candidate) => candidate.id === implied)) issues.push(makeIssue('error', 'rules', `${rule.id} implica rule inexistente "${implied}"`));
        }
      } else if (rule.implies) {
        issues.push(makeIssue('error', 'rules', `${rule.id}.implies debe ser array`));
      }
      for (const s of rule.skills || []) {
        if (!isSafeId(String(s))) issues.push(makeIssue('error', 'rules', `${rule.id} referencia skill con id inseguro "${s}"`));
        if (!skillSet.has(s)) issues.push(makeIssue('error', 'rules', `${rule.id} referencia skill inexistente "${s}"`));
      }
      for (const m of [...(rule.mcp || []), ...(rule.optionalMcp || [])]) {
        if (!isSafeId(String(m))) issues.push(makeIssue('error', 'rules', `${rule.id} referencia MCP con id inseguro "${m}"`));
        if (!mcpSet.has(m)) issues.push(makeIssue('error', 'rules', `${rule.id} referencia MCP inexistente "${m}"`));
      }
    }
  }

  if (runCatalog) {
    for (const id of skillIds) {
      if (!isSafeId(id)) issues.push(makeIssue('error', 'skills', `${id} usa un id inseguro`));
      const skillFile = join(CATALOG, 'skills', id, 'SKILL.md');
      if (!existsSync(skillFile)) issues.push(makeIssue('error', 'skills', `${id} no tiene SKILL.md`));
      else {
        const text = await readFile(skillFile, 'utf8');
        if (!/^---\r?\n[\s\S]*?\r?\n---/.test(text)) issues.push(makeIssue('warn', 'skills', `${id} no tiene frontmatter YAML`));
        if (!/^name:[^\S\r\n]*\S/m.test(text)) issues.push(makeIssue('warn', 'skills', `${id} no declara name`));
        if (!/^description:[^\S\r\n]*\S/m.test(text)) issues.push(makeIssue('warn', 'skills', `${id} no declara description`));
      }
    }
    for (const m of mcpFiles) {
      if (m.error) {
        issues.push(makeIssue('error', 'mcp', `${m.file} no es JSON válido`, m.error.message));
        continue;
      }
      const def = m.json;
      if (!def.id) issues.push(makeIssue('error', 'mcp', `${m.file} no tiene id`));
      else if (!isSafeId(def.id)) issues.push(makeIssue('error', 'mcp', `${m.file} tiene id inseguro "${def.id}"`));
      if (def.id && m.file !== `${def.id}.json`) issues.push(makeIssue('warn', 'mcp', `${m.file} no coincide con id "${def.id}"`));
      if (!def.server?.command) issues.push(makeIssue('error', 'mcp', `${def.id || m.file} no tiene server.command`));
      else if (hasShellSyntax(def.server.command)) issues.push(makeIssue('error', 'mcp', `${def.id || m.file}.server.command no debe incluir espacios ni sintaxis de shell`));
      if (def.server?.args && !Array.isArray(def.server.args)) issues.push(makeIssue('error', 'mcp', `${def.id || m.file}.server.args debe ser array`));
      if (Array.isArray(def.server?.args)) {
        for (const arg of def.server.args) {
          if (typeof arg !== 'string') issues.push(makeIssue('error', 'mcp', `${def.id || m.file}.server.args debe contener strings`));
        }
      }
      if (def.server?.env) {
        if (typeof def.server.env !== 'object' || Array.isArray(def.server.env)) issues.push(makeIssue('error', 'mcp', `${def.id || m.file}.server.env debe ser objeto`));
        else {
          for (const [key, value] of Object.entries(def.server.env)) {
            if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) issues.push(makeIssue('warn', 'mcp', `${def.id || m.file}.server.env usa nombre extraño "${key}"`));
            if (typeof value !== 'string') issues.push(makeIssue('error', 'mcp', `${def.id || m.file}.server.env.${key} debe ser string`));
          }
        }
      }
    }
    for (const p of profileFiles) {
      if (p.error) {
        issues.push(makeIssue('error', 'profiles', `${p.file} no es JSON válido`, p.error.message));
        continue;
      }
      const profile = p.json;
      if (!profile.id) issues.push(makeIssue('error', 'profiles', `${p.file} no tiene id`));
      else if (!isSafeId(profile.id)) issues.push(makeIssue('error', 'profiles', `${p.file} tiene id inseguro "${profile.id}"`));
      if (profile.id && p.file !== `${profile.id}.json`) issues.push(makeIssue('warn', 'profiles', `${p.file} no coincide con id "${profile.id}"`));
      for (const task of ['spec', 'qa', 'repair']) {
        const entry = profile.models?.[task];
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) issues.push(makeIssue('error', 'profiles', `${profile.id || p.file}.models.${task} debe mapear proveedor→modelo`));
        else {
          for (const provider of Object.keys(entry)) if (!PROVIDERS[provider]) issues.push(makeIssue('warn', 'profiles', `${profile.id}.models.${task} usa proveedor desconocido "${provider}"`));
        }
      }
    }
  }

  if (runMethods) {
    if (existsSync(METHODS_DIR)) {
      const dirs = (await readdir(METHODS_DIR, { withFileTypes: true })).filter((d) => d.isDirectory());
      for (const d of dirs) {
        const dir = join(METHODS_DIR, d.name);
        const file = join(dir, 'method.json');
        if (!existsSync(file)) {
          issues.push(makeIssue('error', 'methods', `${d.name} no tiene method.json`));
          continue;
        }
        let meta;
        try { meta = JSON.parse(await readFile(file, 'utf8')); } catch (e) {
          issues.push(makeIssue('error', 'methods', `${d.name}/method.json no es válido`, e.message));
          continue;
        }
        if (!meta.id) issues.push(makeIssue('error', 'methods', `${d.name}/method.json no tiene id`));
        else if (!isSafeId(meta.id)) issues.push(makeIssue('error', 'methods', `${d.name}/method.json tiene id inseguro "${meta.id}"`));
        else if (meta.id !== d.name) issues.push(makeIssue('warn', 'methods', `${d.name}/method.json id no coincide con carpeta "${meta.id}"`));
        const modes = meta.modes || [{ id: 'default', scaffold: meta.scaffold, rules: meta.rules }];
        for (const mode of modes) {
          if (!mode.id) issues.push(makeIssue('error', 'methods', `${meta.id || d.name} tiene un modo sin id`));
          else if (!isSafeId(mode.id)) issues.push(makeIssue('error', 'methods', `${meta.id || d.name} tiene modo con id inseguro "${mode.id}"`));
          const scaffoldDirs = localizedFiles(mode.scaffold);
          if (!scaffoldDirs.length) issues.push(makeIssue('error', 'methods', `${meta.id || d.name}:${mode.id || '?'} scaffold debe ser string u objeto de strings por idioma`));
          for (const scaffold of scaffoldDirs) {
            if (!existsSync(join(dir, scaffold))) issues.push(makeIssue('error', 'methods', `${meta.id || d.name}:${mode.id || '?'} scaffold no existe`, scaffold));
          }
          const ruleFiles = localizedFiles(mode.rules);
          if (!ruleFiles.length) issues.push(makeIssue('error', 'methods', `${meta.id || d.name}:${mode.id || '?'} rules debe ser string u objeto de strings por idioma`));
          for (const file of ruleFiles) {
            if (!existsSync(join(dir, file))) issues.push(makeIssue('error', 'methods', `${meta.id || d.name}:${mode.id || '?'} rules no existe`, file));
          }
        }
      }
    }
  }

  if (runTargets) {
    const targets = existsSync(TARGETS_DIR) ? (await readdir(TARGETS_DIR)).filter((f) => f.endsWith('.mjs')) : [];
    for (const file of targets) {
      const id = file.replace(/\.mjs$/, '');
      if (!isSafeId(id)) issues.push(makeIssue('error', 'targets', `${file} usa id inseguro`));
      try {
        const mod = await import(pathToFileURL(join(TARGETS_DIR, file)).href);
        if (!mod.label) issues.push(makeIssue('warn', 'targets', `${file} no exporta label`));
        if (typeof mod.apply !== 'function') issues.push(makeIssue('error', 'targets', `${file} no exporta apply()`));
      } catch (e) {
        issues.push(makeIssue('error', 'targets', `${file} no carga`, e.message));
      }
    }
    if (!targets.length) issues.push(makeIssue('error', 'targets', 'no hay targets disponibles'));
  }

  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warn');
  const selected = verbose ? issues : errors.concat(warnings.slice(0, 20));
  printIssues(t('doctorDiagnosis'), selected);
  if (!verbose && warnings.length > 20) console.log(c.dim('  ' + t('doctorMoreWarnings', warnings.length - 20)));

  console.log('\n' + c.bold(t('summary')));
  console.log(`  rules   : ${ruleFiles.filter((r) => r.json).length}`);
  console.log(`  skills  : ${skillIds.length}`);
  console.log(`  mcp     : ${mcpIds.length}`);
  console.log(`  profiles: ${profileFiles.filter((p) => p.json).length}`);
  console.log(`  targets : ${existsSync(TARGETS_DIR) ? (await readdir(TARGETS_DIR)).filter((f) => f.endsWith('.mjs')).length : 0}`);
  console.log(`  ${t('doctorErrors')} : ${errors.length}`);
  console.log(`  ${t('doctorWarnings')}  : ${warnings.length}\n`);

  if (errors.length) process.exit(1);
}
