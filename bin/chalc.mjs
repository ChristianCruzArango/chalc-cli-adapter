#!/usr/bin/env node
// ⚙️ chalc — equipa cualquier proyecto con skills/MCP/métodos correctos. Interactivo, sin IA.
//
// Uso:
//   chalc [rutaProyecto]                 modo interactivo (te pregunta qué montar)
//   chalc inspect [rutaProyecto]         explica qué detecta y por qué, sin escribir
//   chalc doctor                         valida reglas, catálogo, MCP, métodos y targets
//   chalc configure                      configura rules, skills y MCP de forma interactiva
//   chalc spec                           crea una carpeta/plantilla vacía specs/NNN-feature
//   chalc install <fuente> [--stack id]  instala un skill al catálogo y lo cablea a una regla
//   chalc [ruta] --yes                   sin preguntas: equipa el stack detectado
//   chalc [ruta] --method sdd[:full]     activa un método sin preguntar
//   chalc [ruta] --target claude         elige asistente destino (default: claude)
//   chalc [ruta] --dry-run               muestra el plan sin escribir
//
// <fuente> de install: URL de Git/GitHub, nombre/URL de skills.sh, o ruta local.
// Flujo apply: lee señales del proyecto -> aplica reglas -> resuelve skills/MCP/métodos
// del catálogo -> el target los proyecta a los archivos del asistente. Cero IA, cero tokens.

import { access, cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync, constants } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { emitKeypressEvents } from 'node:readline';
import { spawn } from 'node:child_process';
import { stdin, stdout } from 'node:process';
import { installSkill } from '../lib/install.mjs';
import { t, lang, saveLang } from '../lib/i18n.mjs';
import { PROVIDERS, applyProfileModels, configForTask, loadConfig, modelForTask, saveConfig, isConfigured, listModels, CONFIG_PATH } from '../lib/ai.mjs';
import { readDocument } from '../lib/docread.mjs';
import { fetchAzureDevOps, fetchJira, fetchUrl } from '../lib/sources.mjs';
import { buildPrompt, generateSpec } from '../lib/specgen.mjs';
import { assertSafeId, isSafeId } from '../lib/ids.mjs';
import { parseArgs } from '../lib/args.mjs';
import { detectContext, formatDetect, matchRules, ruleReasons } from '../lib/detect.mjs';
import { verifyProject } from '../lib/verify.mjs';
import { tokenSummary } from '../lib/tokenmeter.mjs';
import { orchestrateFeature } from '../lib/featureorch.mjs';
import { resolveFeatureFolder, sharedNumber, nextNumber, contractFingerprint, contractStamp, stampFiles, readContractLock, writeContractLock } from '../lib/specfolder.mjs';
import { safePull, createFeatureBranch } from '../lib/gitprep.mjs';
import { buildStartCommand, detectAuth, detectSurface, findEnvironmentOptions, guessBaseUrls, listSpecs, normalizeQaUrl, probeDocker, probePlaywright, qaAgentTestPath, qaComposeProjectName, qaPlanPath, qaResultsPath, readQaInputs, readSpecContext, requirements, selectEnvironment, writeBrowserTests, writeQaInputs, writeQaPlan } from '../lib/qa.mjs';
import { buildAgentReplaySpec, buildRepairPlanMarkdown, buildResultsMarkdown, createBrowserExecutor, httpExecutor, parseResultsMarkdown, runQaAgent } from '../lib/qaagent.mjs';
import { appendAiTrace, makeAiTrace } from '../lib/aitrace.mjs';
import { runLocalAiEvals } from '../lib/aieval.mjs';
import { summarizeValidation } from '../lib/specvalidate.mjs';
import { analyzeProjectProposal, architectureSkills, archText, buildArchitectureDecision, dartPackageName, getStack, listStacks, localizeComplexity, localizeType, MANDATORY_DESIGN_PRINCIPLES, resolveScaffoldTool, scaffoldSteps, slugifyProjectName, suggestArchitectures, verifySteps } from '../lib/init.mjs';
import { reshapeProject } from '../lib/init-scaffold.mjs';
import { procOpts } from '../lib/proc.mjs';
import { analyzeArchitectureWithAi } from '../lib/initai.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHALC_ROOT = resolve(HERE, '..');
const CATALOG = join(CHALC_ROOT, 'catalog');
const PROFILES_DIR = join(CATALOG, 'profiles');
const RULES_DIR = join(CHALC_ROOT, 'rules');
const METHODS_DIR = join(CATALOG, 'methods');
const TARGETS_DIR = join(CHALC_ROOT, 'targets');

// ---------- args ----------
const argv = process.argv.slice(2);
const { flags, positional } = parseArgs(argv);
const first = (positional[0] || '').toLowerCase();
const verb = ['lang', 'config-lang', 'idioma', 'language'].includes(first) ? 'lang'
  : ['init', 'new', 'create'].includes(first) ? 'init'
  : ['install', 'add'].includes(first) ? 'install'
  : ['inspect', 'explain'].includes(first) ? 'inspect'
    : ['verify', 'check', 'audit'].includes(first) ? 'verify'
    : ['doctor'].includes(first) ? 'doctor'
      : ['configure', 'config', 'setup'].includes(first) ? 'configure'
        : ['config-ia', 'config-ai', 'configia', 'ai', 'provider'].includes(first) ? 'ai'
          : ['ai-doctor', 'doctor-ia'].includes(first) ? 'aidoctor'
            : ['eval-ia', 'eval-ai', 'ai-eval'].includes(first) ? 'aieval'
          : ['spec-ia', 'spec-ai', 'spec-gen', 'specgen', 'gen'].includes(first) ? 'specgen'
        : ['feature', 'hu', 'fullstack'].includes(first) ? 'feature'
      : ['spec', 'specs'].includes(first) ? 'spec'
        : ['qa', 'quality'].includes(first) ? 'qa'
    : 'apply';
const installSource = verb === 'install' ? positional[1] : null;
const specArgs = verb === 'spec' ? positional.slice(1) : [];
const specLastArg = specArgs.at(-1);
const specProjectArg = specArgs.length > 1 && specLastArg && (existsSync(resolve(cleanPath(specLastArg))) || looksLikePath(specLastArg)) ? specLastArg : null;
const projectArg = verb === 'install' ? positional[2] : verb === 'inspect' ? positional[1] : verb === 'doctor' ? positional[1] : verb === 'spec' ? specProjectArg : verb === 'qa' ? positional[1] : positional[0];
const projectPath = resolve(projectArg || process.cwd());
const dryRun = !!flags['dry-run'];
const assumeYes = !!flags.yes || !!flags.y;
const force = !!flags.force;
const allowExternalExec = !!flags['allow-exec'];
const methodFlags = flags.method ? [].concat(flags.method).map(String) : [];
const interactive = !!stdin.isTTY && !assumeYes;

// ---------- estilo ----------
const c = {
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`
};

// Red de seguridad: nunca mostrar stack traces. Ctrl+C (AbortError) sale limpio.
const onAbortOrError = (e) => {
  if (e && (e.code === 'ABORT_ERR' || e.name === 'AbortError')) { process.stdout.write('\n'); process.exit(130); }
  console.error(c.red('✗ ' + (e && e.message ? e.message : e)));
  process.exit(1);
};
process.on('uncaughtException', onAbortOrError);
process.on('unhandledRejection', onAbortOrError);

// ---------- helpers ----------
// Limpia una ruta escrita a mano: comillas envolventes, espacios y ~ → HOME.
// (un usuario suele pegar '/ruta con espacios' con comillas; sin esto, resolve() la trata como relativa)
function cleanPath(p) {
  return p
    .trim()
    .replace(/^(['"])(.*)\1$/, '$2')   // quita comillas envolventes ' o "
    .replace(/\\ /g, ' ')               // espacios escapados \  →  espacio
    .replace(/^~(?=[/\\]|$)/, homedir())  // ~ → HOME del usuario (USERPROFILE en Windows)
    .trim();
}

function looksLikePath(p) {
  const s = cleanPath(p);
  return s.startsWith('/') || s.startsWith('./') || s.startsWith('../') || s.startsWith('~/') ||
    s.includes('/') || s.includes('\\') || /^[a-zA-Z]:/.test(s);  // también rutas de Windows (\, C:\)
}

// Muestra una ruta con '/' para que la salida del CLI sea idéntica en cualquier SO.
function disp(p) {
  return String(p).replace(/\\/g, '/');
}

function deepSub(obj, vars) {
  if (typeof obj === 'string') return obj.replace(/\$\{(\w+)\}/g, (_, k) => vars[k] ?? `\${${k}}`);
  if (Array.isArray(obj)) return obj.map((v) => deepSub(v, vars));
  if (obj && typeof obj === 'object') {
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, deepSub(v, vars)]));
  }
  return obj;
}

async function loadJsonDir(dir) {
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  return Promise.all(files.map(async (f) => JSON.parse(await readFile(join(dir, f), 'utf8'))));
}

async function loadMcp(id) {
  id = assertSafeId(id, 'MCP id');
  const file = join(CATALOG, 'mcp', `${id}.json`);
  if (!existsSync(file)) throw new Error(t('mcpNotInCatalog', id));
  const def = JSON.parse(await readFile(file, 'utf8'));
  def.id = assertSafeId(def.id || id, 'MCP id');
  return def;
}

// Elige el valor en el idioma dado (default = idioma del CLI); acepta string (legado) u objeto {es,en,...}.
function pick(val, l = lang) {
  if (val && typeof val === 'object' && !Array.isArray(val)) return val[l] ?? val.en ?? Object.values(val)[0];
  return val;
}

// Normaliza un nombre/código de idioma a 'es'/'en' (para elegir archivos del método). Otros → idioma del CLI.
function langCode(v) {
  const s = String(v || '').toLowerCase();
  if (/espa|spanish|castell/.test(s) || s === 'es') return 'es';
  if (/engl|ingl/.test(s) || s === 'en') return 'en';
  return lang;
}

async function loadMethods(l = lang) {
  if (!existsSync(METHODS_DIR)) return [];
  const dirs = (await readdir(METHODS_DIR, { withFileTypes: true })).filter((d) => d.isDirectory());
  return Promise.all(dirs.map(async (d) => {
    const dir = join(METHODS_DIR, d.name);
    const meta = JSON.parse(await readFile(join(dir, 'method.json'), 'utf8'));
    meta.id = assertSafeId(meta.id, 'method id');
    const explainFile = pick(meta.explain, l);
    const explainText = explainFile && existsSync(join(dir, explainFile))
      ? await readFile(join(dir, explainFile), 'utf8') : '';
    const rawModes = meta.modes || [{ id: 'default', label: meta.label, scaffold: meta.scaffold, rules: meta.rules }];
    const modes = await Promise.all(rawModes.map(async (m) => ({
      id: assertSafeId(m.id, 'method mode id'), label: pick(m.label, l),
      scaffoldDir: join(dir, pick(m.scaffold, l)),
      rulesText: await readFile(join(dir, pick(m.rules, l)), 'utf8')
    })));
    return { id: meta.id, label: pick(meta.label, l), description: pick(meta.description, l), explainText, modes };
  }));
}

async function loadTargets() {
  if (!existsSync(TARGETS_DIR)) return [];
  const files = (await readdir(TARGETS_DIR)).filter((f) => f.endsWith('.mjs'));
  return Promise.all(files.map(async (file) => {
    const id = file.replace(/\.mjs$/, '');
    const mod = await import(pathToFileURL(join(TARGETS_DIR, file)).href);
    return { id, label: mod.label || id };
  }));
}

async function loadAiProfile(id = 'chalc-default') {
  const safe = assertSafeId(id || 'chalc-default', 'profile id');
  const file = join(PROFILES_DIR, `${safe}.json`);
  if (!existsSync(file)) return null;
  const profile = JSON.parse(await readFile(file, 'utf8'));
  profile.id = assertSafeId(profile.id || safe, 'profile id');
  return profile;
}

async function listAiProfiles() {
  if (!existsSync(PROFILES_DIR)) return [];
  const files = (await readdir(PROFILES_DIR)).filter((f) => f.endsWith('.json'));
  return Promise.all(files.map(async (file) => JSON.parse(await readFile(join(PROFILES_DIR, file), 'utf8'))));
}

async function resolveAiTaskConfig(task) {
  let cfg = await loadConfig();
  const profile = await loadAiProfile(String(flags.profile || cfg.profile || 'chalc-default'));
  cfg = applyProfileModels(cfg, profile);
  const flagName = `${task}-model`;
  if (flags[flagName]) cfg.models = { ...(cfg.models || {}), [task]: String(flags[flagName]) };
  return configForTask(cfg, task);
}

// Cablea un skill a una regla (esto es lo que llena el sistema con el uso).
async function addSkillToRule(ruleId, skillId) {
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

function formatList(items, empty = '—') {
  return items.length ? items.join(', ') : empty;
}

function slugifyFeatureName(name) {
  return cleanPath(name)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'feature';
}

function slugifyId(name) {
  return cleanPath(name)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function writeJson(file, obj) {
  await writeFile(file, JSON.stringify(obj, null, 2) + '\n');
}

async function loadRules() {
  return (await loadJsonDir(RULES_DIR)).sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

async function chooseRule(prompter, q = t('ruleAddToWhich')) {
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

async function addMcpToRule(ruleId, mcpId, optional = false) {
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

async function addExistingSkillToRule(prompter) {
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

async function createRuleWizard(prompter) {
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

async function installSkillWizard(prompter) {
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

async function createMcpWizard(prompter) {
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

async function addMcpWizard(prompter) {
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

async function ensureSddScaffold(projectPath, mode = 'lite') {
  const specsDir = join(projectPath, 'specs');
  const templateDir = join(specsDir, '_template');
  if (existsSync(templateDir) && existsSync(join(specsDir, 'constitution.md'))) return specsDir;

  const base = mode === 'full' ? 'scaffold-full' : 'scaffold-lite';
  const scaffoldName = (lang === 'en' && existsSync(join(METHODS_DIR, 'sdd', `${base}-en`))) ? `${base}-en` : base;
  const scaffoldDir = join(METHODS_DIR, 'sdd', scaffoldName);
  if (!existsSync(scaffoldDir)) throw new Error(`No existe el scaffold SDD: ${scaffoldName}`);
  await cp(scaffoldDir, projectPath, { recursive: true, force: false, errorOnExist: false, dereference: true });
  await mkdir(specsDir, { recursive: true });
  return specsDir;
}

// Equipa el proyecto para spec-ia: skills (incl. mutation-testing global) + MCP + método SDD,
// vía el target. Devuelve la lista de skills equipadas (para el hand-off).
async function equipForSpec(proj, mode, targetName, specLang) {
  targetName = assertSafeId(targetName, 'target');
  const ctx = await detectContext(proj);
  const rules = await loadJsonDir(RULES_DIR);
  const matched = matchRules(rules, ctx);
  const stacks = matched.filter((r) => !r.always);
  const skills = [...new Set(matched.flatMap((r) => r.skills || []))];
  const mcpIds = [...new Set(matched.flatMap((r) => r.mcp || []))];   // obligatorios; los opcionales (secretos) se omiten
  const mcps = await Promise.all(mcpIds.map(async (id) => {
    const def = await loadMcp(id);
    return { id: def.id, description: def.description, server: deepSub(def.server, { PROJECT: proj }) };
  }));
  // El método (constitución/plantillas/reglas) se monta en el idioma del SPEC, no el del CLI.
  const sdd = (await loadMethods(langCode(specLang))).find((x) => x.id === 'sdd');
  const m = sdd && (sdd.modes.find((x) => x.id === mode) || sdd.modes[0]);
  const methods = m ? [{ id: sdd.id, label: sdd.label, mode: m.id, scaffoldDir: m.scaffoldDir, rulesText: m.rulesText }] : [];
  const targetFile = join(TARGETS_DIR, `${targetName}.mjs`);
  const target = existsSync(targetFile)
    ? await import(pathToFileURL(targetFile).href)
    : await import(pathToFileURL(join(TARGETS_DIR, 'claude.mjs')).href);
  await target.apply({ projectPath: proj, CATALOG, skills, mcps, methods, stacks, dryRun: false });
  return skills;
}

async function equipCreatedProject(proj, { targetName = 'claude', methodMode = 'lite', extraSkills = [], architecture = null } = {}) {
  targetName = assertSafeId(targetName, 'target');
  const ctx = await detectContext(proj);
  const rules = await loadJsonDir(RULES_DIR);
  const matched = matchRules(rules, ctx);
  const stacks = matched.filter((r) => !r.always);
  const skills = [...new Set([...matched.flatMap((r) => r.skills || []), ...extraSkills])];
  const mcpIds = [...new Set(matched.flatMap((r) => r.mcp || []))];
  const mcps = await Promise.all(mcpIds.map(async (id) => {
    const def = await loadMcp(id);
    return { id: def.id, description: def.description, server: deepSub(def.server, { PROJECT: proj }) };
  }));
  const sdd = (await loadMethods()).find((x) => x.id === 'sdd');
  const m = sdd && (sdd.modes.find((x) => x.id === methodMode) || sdd.modes[0]);
  const methods = m ? [{ id: sdd.id, label: sdd.label, mode: m.id, scaffoldDir: m.scaffoldDir, rulesText: m.rulesText }] : [];
  const targetFile = join(TARGETS_DIR, `${targetName}.mjs`);
  if (!existsSync(targetFile)) throw new Error(`Target no existe: ${targetName}`);
  const target = await import(pathToFileURL(targetFile).href);
  const applied = await target.apply({ projectPath: proj, CATALOG, skills, mcps, methods, stacks, architecture, dryRun: false });
  return { skills, mcps, methods, stacks, plan: applied.plan };
}

function makeIssue(level, area, message, detail = '') {
  return { level, area, message, detail };
}

function localizedFiles(value) {
  if (typeof value === 'string') return [value];
  if (value && typeof value === 'object' && !Array.isArray(value)) return Object.values(value).filter((v) => typeof v === 'string');
  return [];
}

function duplicates(items) {
  const seen = new Set();
  const dupes = new Set();
  for (const item of items) {
    if (seen.has(item)) dupes.add(item);
    else seen.add(item);
  }
  return [...dupes];
}

function hasShellSyntax(value) {
  return /[\s;&|`$<>]/.test(String(value || ''));
}

function printIssues(title, issues) {
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

async function loadJsonFiles(dir) {
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  const out = [];
  for (const file of files) {
    const path = join(dir, file);
    try {
      out.push({ file, path, json: JSON.parse(await readFile(path, 'utf8')) });
    } catch (e) {
      out.push({ file, path, error: e });
    }
  }
  return out;
}

// ---------- prompts interactivos ----------
function makePrompter() {
  const yes = new Set(['y', 's', 'si', 'sí', 'yes']);

  // Una pregunta de texto = un readline efímero (deja stdin libre para el selector de flechas).
  function ask(query) {
    return new Promise((res) => {
      const rl = createInterface({ input: stdin, output: stdout });
      rl.question(query)
        .then((a) => { rl.close(); res(a); })
        .catch(() => {           // Ctrl+C en una pregunta: cancelar limpio, sin stack trace
          rl.close();
          stdout.write('\n' + c.dim(t('cancelled')) + '\n');
          process.exit(130);
        });
    });
  }

  // Selector con flechas ↑/↓ + Enter (modo raw). Fallback a números si no hay TTY.
  function arrowSelect(q, options, def = 0) {
    return new Promise((resolve) => {
      let idx = Math.max(0, Math.min(def, options.length - 1));
      stdout.write(`${c.cyan('?')} ${q}  ${c.dim(t('arrowHint'))}\n`);
      const draw = () => {
        options.forEach((o, i) => {
          const line = i === idx ? c.cyan(`❯ ${o.label}`) : `  ${c.dim(o.label)}`;
          stdout.write('\x1b[2K' + line + '\n');
        });
      };
      draw();
      emitKeypressEvents(stdin);
      const wasRaw = !!stdin.isRaw;
      if (stdin.isTTY) stdin.setRawMode(true);
      stdin.resume();
      const done = () => {
        stdin.removeListener('keypress', onKey);
        if (stdin.isTTY) stdin.setRawMode(wasRaw);
        stdin.pause();
        resolve(idx);
      };
      const onKey = (_s, key) => {
        if (!key) return;
        if (key.name === 'up' || key.name === 'k') idx = (idx - 1 + options.length) % options.length;
        else if (key.name === 'down' || key.name === 'j') idx = (idx + 1) % options.length;
        else if (key.name === 'return' || key.name === 'enter') return done();
        else if (key.ctrl && key.name === 'c') { done(); stdout.write('\n'); process.exit(130); }   // 130: cancelado, no éxito
        else return;
        stdout.write(`\x1b[${options.length}A`);   // sube N líneas y redibuja las opciones
        draw();
      };
      stdin.on('keypress', onKey);
    });
  }

  async function numberedSelect(q, options, def = 0) {
    console.log(`${c.cyan('?')} ${q}`);
    options.forEach((o, i) => console.log(`    ${i + 1}) ${o.label}${i === def ? c.dim('  ‹enter›') : ''}`));
    while (true) {
      const ans = (await ask(`  ${c.dim('>')} `)).trim();
      if (!ans) return def;
      const n = parseInt(ans, 10);
      if (n >= 1 && n <= options.length) return n - 1;
      console.log(c.dim('    ' + t('optionInvalid')));
    }
  }

  // Selector con buscador: escribe para filtrar por substring, ↑/↓ se mueve por lo filtrado, Enter elige.
  // Devuelve el índice ORIGINAL (en `options`), no el de la vista filtrada.
  function searchSelect(q, options) {
    return new Promise((resolve) => {
      let query = '';
      let idx = 0;
      const match = () => options.map((o, i) => ({ o, i })).filter(({ o }) => o.label.toLowerCase().includes(query.toLowerCase()));
      let view = match();
      let prevLines = 0;
      const render = () => {
        if (prevLines) stdout.write(`\x1b[${prevLines}A`);
        stdout.write('\x1b[J');
        stdout.write(`${c.cyan('?')} ${q}  ${c.dim('escribe para filtrar · ↑/↓ · enter')}\n`);
        stdout.write(`  ${c.dim('buscar:')} ${query}${c.dim('▏')}\n`);
        if (!view.length) stdout.write('  ' + c.dim('(sin coincidencias)') + '\n');
        else view.forEach(({ o }, i) => stdout.write((i === idx ? c.cyan(`❯ ${o.label}`) : `  ${c.dim(o.label)}`) + '\n'));
        prevLines = 2 + (view.length || 1);
      };
      render();
      emitKeypressEvents(stdin);
      const wasRaw = !!stdin.isRaw;
      if (stdin.isTTY) stdin.setRawMode(true);
      stdin.resume();
      const done = (result) => {
        stdin.removeListener('keypress', onKey);
        if (stdin.isTTY) stdin.setRawMode(wasRaw);
        stdin.pause();
        resolve(result);
      };
      const onKey = (ch, key) => {
        if (!key) return;
        if (key.name === 'up') idx = view.length ? (idx - 1 + view.length) % view.length : 0;
        else if (key.name === 'down') idx = view.length ? (idx + 1) % view.length : 0;
        else if (key.name === 'return' || key.name === 'enter') { if (view.length) return done(view[idx].i); return; }
        else if (key.ctrl && key.name === 'c') { done(view.length ? view[idx].i : 0); stdout.write('\n'); process.exit(130); }   // 130: cancelado, no éxito
        else if (key.name === 'backspace') { query = query.slice(0, -1); view = match(); idx = 0; }
        else if (ch && !key.ctrl && ch >= ' ') { query += ch; view = match(); idx = 0; }
        else return;
        render();
      };
      stdin.on('keypress', onKey);
    });
  }

  return {
    async text(q) { return (await ask(`${c.cyan('?')} ${q} `)).trim(); },
    async yesno(q, def = false) {
      const ans = (await ask(`${c.cyan('?')} ${q} ${def ? '[Y/n]' : '[y/N]'} `)).trim().toLowerCase();
      if (!ans) return def;
      return yes.has(ans);
    },
    async select(q, options, def = 0, opts = {}) {
      if (!stdin.isTTY) return numberedSelect(q, options, def);
      return opts.search ? searchSelect(q, options) : arrowSelect(q, options, def);
    },
    async multi(q, options, def = []) {
      console.log(`${c.cyan('?')} ${q} ${c.dim(t('multiHint'))}`);
      options.forEach((o, i) => console.log(`    ${i + 1}) ${o.label}`));
      const ans = (await ask(`  ${c.dim('>')} `)).trim().toLowerCase();
      if (!ans) return def;
      if (ans === 'a') return options.map((_, i) => i);
      return [...new Set(ans.split(/[,\s]+/).map((n) => parseInt(n, 10) - 1).filter((n) => n >= 0 && n < options.length))];
    },
    // Entrada enmascarada (para API keys): muestra '*' y nunca eco del texto real.
    async secret(q) {
      if (!stdin.isTTY) return (await ask(`${c.cyan('?')} ${q} `)).trim();
      return new Promise((resolve) => {
        stdout.write(`${c.cyan('?')} ${q} `);
        emitKeypressEvents(stdin);
        const wasRaw = !!stdin.isRaw;
        stdin.setRawMode(true);
        stdin.resume();
        let buf = '';
        const finish = () => {
          stdin.removeListener('keypress', onKey);
          stdin.setRawMode(wasRaw);
          stdin.pause();
          stdout.write('\n');
          resolve(buf.trim());
        };
        const onKey = (ch, key) => {
          if (key && (key.name === 'return' || key.name === 'enter')) return finish();
          if (key && key.ctrl && key.name === 'c') { finish(); process.exit(0); }
          if (key && (key.name === 'backspace' || key.name === 'delete')) {
            if (buf) { buf = buf.slice(0, -1); stdout.write('\b \b'); }
            return;
          }
          if (ch && !(key && key.ctrl) && ch >= ' ') { buf += ch; stdout.write('*'); }
        };
        stdin.on('keypress', onKey);
      });
    },
    close() { }
  };
}

// Pregunta a qué stack pertenece un skill y lo cablea a la regla. Devuelve el ruleId o null.
async function associate(prompter, rules, skillId, stackFlag) {
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
async function runInstall() {
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

// ---------- comando: chalc inspect ----------
async function runInspect() {
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

// ---------- comando: chalc doctor ----------
async function runDoctor() {
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

// ---------- comando: chalc spec ----------
async function runSpec() {
  let proj = projectPath;
  let featureName = flags.name ? String(flags.name) : (specProjectArg ? specArgs.slice(0, -1).join(' ') : specArgs.join(' '));
  const prompter = interactive ? makePrompter() : null;

  if (prompter) {
    console.log('\n' + c.bold('⚙️  chalc spec') + '\n');
    const ans = await prompter.text(t('qaPathQ', c.dim(`[${proj}]`)));
    if (ans) proj = resolve(cleanPath(ans));
    while (!featureName) {
      featureName = await prompter.text(t('specFolderNameQ'));
    }
  } else {
    console.log('\n' + c.bold('⚙️  chalc spec') + c.dim(`  ·  ${disp(proj)}`) + '\n');
    if (!featureName) throw new Error(t('specUsage'));
  }
  if (!existsSync(proj)) { if (prompter) prompter.close(); throw new Error(t('pathMissing', proj)); }

  let mode = String(flags.mode || 'lite');
  if (prompter && !existsSync(join(proj, 'specs', '_template'))) {
    const modes = [
      { label: 'lite — constitution + spec + plan + tasks', value: 'lite' },
      { label: 'full — + research, data-model, contracts, quickstart', value: 'full' }
    ];
    mode = modes[await prompter.select(t('specScaffoldQ'), modes, 0)].value;
  }
  if (!['lite', 'full'].includes(mode)) { if (prompter) prompter.close(); throw new Error(t('specModeInvalid', mode)); }

  const specsDir = await ensureSddScaffold(proj, mode);
  const slug = slugifyFeatureName(featureName);
  const number = await nextNumber(specsDir);
  const featureDir = join(specsDir, `${number}-${slug}`);
  if (existsSync(featureDir)) { if (prompter) prompter.close(); throw new Error(t('specAlreadyExists', featureDir)); }

  const templateDir = join(specsDir, '_template');
  if (!existsSync(templateDir)) { if (prompter) prompter.close(); throw new Error(t('specNoTemplate', templateDir)); }
  await cp(templateDir, featureDir, { recursive: true, dereference: true, force: false });

  if (prompter) prompter.close();
  console.log(c.green(`✓ ${t('specCreated', featureDir)}`));
  console.log(c.dim('  ' + t('specOfficialPath')));
  console.log(c.dim('  ' + t('specNoWrite')));
  console.log(c.dim('  ' + t('specRealNote') + '\n'));
}

// Pide al SO un puerto libre (bind a :0). Así forzamos el dev server ahí y evitamos choques y adivinanzas.
// Levanta el entorno y espera a que la URL responda. Devuelve { health, stop }: el caller decide cuándo bajarlo.
// NO fuerza el puerto: lee la URL que el propio dev server anuncia (ng/vite/next la imprimen), así respeta
// la config de la app — forzar un puerto random rompe Module Federation (el remoteEntry queda apuntando al viejo).
async function startEnvironment(env, proj, healthUrls) {
  const candidates = (Array.isArray(healthUrls) ? healthUrls : [healthUrls]).filter(Boolean);
  const start = buildStartCommand(env);   // lanza si el entorno no es arrancable
  const runToEnd = (cmd, args) => new Promise((res) => {
    const p = spawn(cmd, args, procOpts({ cwd: proj, stdio: 'ignore' }));
    p.on('error', () => res(-1));
    p.on('exit', (code) => res(code ?? -1));
  });

  console.log('\n▶ ' + t('qaStarting', c.bold(`${start.command} ${start.args.join(' ')}`)) + '  ' + c.dim('· ' + t('qaDiscoveringUrl')));
  let spawnError = null;
  let childExited = false;
  let discovered = null;   // la URL que el propio dev server reporta en su salida
  const onData = (buf) => {
    const text = buf.toString();
    if (!discovered) {
      const m = text.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)/i) || text.match(/listening on\s+(?:localhost|127\.0\.0\.1):(\d+)/i);
      if (m) { discovered = `http://localhost:${m[1]}`; console.log(c.dim('  │ ' + t('qaUrlDetected', discovered))); }
    }
    for (const line of text.split('\n')) if (/error|failed|cannot|compiled|Port \d+ is already/i.test(line)) { const t = line.trim(); if (t) console.log(c.dim(`  │ ${t.slice(0, 160)}`)); }
  };
  // NG_CLI_ANALYTICS=false evita el prompt de analytics de Angular que cuelga en modo no interactivo.
  const child = spawn(start.command, start.args, procOpts({ cwd: proj, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32', env: { ...process.env, NG_CLI_ANALYTICS: 'false' } }));
  child.stdout?.on('data', onData);
  child.stderr?.on('data', onData);
  child.on('error', (e) => { spawnError = e; childExited = true; });
  child.on('exit', () => { childExited = true; });

  // Prioriza la URL anunciada por el server; cae a los candidatos del guess. Hasta 120s (MFE grande compila lento).
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let health = { ok: false, attempts: 0 };
  for (let attempt = 1; attempt <= 120; attempt++) {
    if (start.down === null && childExited) { health = { ok: false, aborted: true, attempts: attempt - 1 }; break; }
    for (const url of [discovered, ...candidates].filter(Boolean)) {
      try { const res = await fetch(url, { method: 'GET' }); health = { ok: true, status: res.status, attempts: attempt, url }; break; } catch { /* siguiente candidato */ }
    }
    if (health.ok) break;
    await sleep(1000);
  }
  if (spawnError) console.log(c.red('✗ ' + t('qaCannotRun', start.command, spawnError.code || spawnError.message)));
  else if (health.ok) console.log(c.green('✓ ' + t('qaResponds', health.url, health.status, health.attempts)));
  else if (health.aborted) console.log(c.red('✗ ' + t('qaProcessEnded')));
  else console.log(c.red('✗ ' + t('qaNoUrlResponded', discovered || t('qaNoneFem'), candidates.join(' | ') || '—')));

  const stop = async () => {
    console.log(c.dim('  ' + t('qaStoppingEnv')));
    if (start.down) await runToEnd(start.down.command, start.down.args);
    else if (!childExited && !child.killed) {
      if (process.platform === 'win32' && child.pid) {
        // shell:true envuelve el proceso en cmd.exe; taskkill /T baja todo el árbol (incluido el dev server).
        try { spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { child.kill(); }
      } else if (child.pid) process.kill(-child.pid, 'SIGTERM');
      else child.kill('SIGTERM');
    }
  };
  return { health, stop };
}

// Bring-up de un solo tiro (para --up): levanta, verifica salud y baja inmediatamente.
async function bringUpEnvironment(env, proj, healthUrl) {
  const { health, stop } = await startEnvironment(env, proj, healthUrl);
  await stop();
  return health;
}

// Detecta si la app exige autenticación y, de ser así, le PIDE al usuario la sesión (no falla en silencio).
// Devuelve { headers?, storage? } para inyectar en el navegador, o null si no hace falta / se omite.
async function promptAuthIfNeeded(prompter, proj) {
  const det = await detectAuth(proj);
  if (!det.needsAuth) return null;
  console.log(c.yellow('\n⚠ ' + t('qaAuthRequired', det.signals.join(', '))));
  if (!prompter) {
    console.log(c.dim('  ' + t('qaAuthNonInteractive')));
    return null;
  }
  const methods = [
    { label: t('qaAuthStorage'), value: 'storage' },
    { label: t('qaAuthHeader'), value: 'header' },
    { label: t('qaAuthSkip'), value: 'skip' }
  ];
  const method = methods[await prompter.select(t('qaAuthMethodQ'), methods, det.storageKeys.length ? 0 : 1)].value;
  if (method === 'skip') return null;
  if (method === 'header') {
    const token = (await prompter.secret(t('qaAuthTokenQ'))).trim();
    return token ? { headers: { Authorization: `Bearer ${token}` } } : null;
  }
  const hint = det.storageKeys.length ? t('qaAuthDetected', det.storageKeys.join(', ')) : '';
  const key = (await prompter.text(t('qaAuthStorageKeyQ', hint))).trim();
  const type = (await prompter.yesno(t('qaAuthIsSessionQ'), false)) ? 'session' : 'local';
  const value = (await prompter.secret(t('qaAuthValueQ'))).trim();
  return key && value ? { storage: [{ type, key, value }] } : null;
}

// Ejecuta un spec con el CLI de Playwright del proyecto (la app debe estar viva). Devuelve el exit code.
function runPlaywrightSpec(proj, testFile, baseUrl) {
  return new Promise((resolve) => {
    const child = spawn('npx', ['playwright', 'test', testFile, '--reporter=line'], procOpts({
      cwd: proj,
      stdio: 'inherit',
      env: { ...process.env, PLAYWRIGHT_BASE_URL: baseUrl, BASE_URL: baseUrl }
    }));
    child.on('error', () => resolve(-1));
    child.on('exit', (code) => resolve(code ?? -1));
  });
}

// Corre el agente QA contra la app ya viva: detecta/usa superficie, ejecuta el loop y escribe results.md.
async function runAgentAgainstLiveApp(context, proj, baseUrl, surfaceOverride, auth) {
  const cfg = await resolveAiTaskConfig('qa');
  if (!isConfigured(cfg)) throw new Error(t('qaAgentNeedsAi'));
  printAiLine(cfg);   // muestra qué proveedor/modelo se usará

  const detected = await detectSurface(proj);
  const surface = (surfaceOverride || detected.surface);
  if (surface !== 'web' && surface !== 'api') {
    throw new Error(t('qaSurfaceUnknown', JSON.stringify(detected.signals)));
  }
  console.log('  ' + t('qaSurface', c.bold(surface)) + (surfaceOverride ? c.dim(' ' + t('qaSurfaceForced')) : c.dim(' ' + t('qaSurfaceDetected', detected.signals[surface]?.join(', ') || '—'))));
  if (auth) console.log(c.dim('  ' + t('qaSessionInjected', auth.headers ? t('qaSessionHeader') : t('qaSessionStorage', auth.storage?.[0]?.key))));

  const inputs = await readQaInputs(proj, context.id);
  let executor;
  if (surface === 'web') {
    try { executor = await createBrowserExecutor(baseUrl, { auth }); }   // lanza un error guía si falta Playwright
    catch (e) { throw new Error(e.message); }
  } else {
    executor = httpExecutor(baseUrl, {
      headers: auth?.headers || {},   // en api, la sesión va como header en cada petición
      allowedMethods: inputs?.allowWriteMethods ? ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH'] : undefined,
      allowedPaths: inputs?.allowedPaths || []
    });
  }

  try {
    console.log(c.dim('  ' + t('qaRunningAgent')));
    const plan = existsSync(qaPlanPath(proj, context.id)) ? await readFile(qaPlanPath(proj, context.id), 'utf8') : context.files['spec.md'];
    // Presupuesto de pasos según cantidad de requisitos: cada R# necesita 1-3 acciones + el veredicto final.
    // Override con --max-steps. Tope de seguridad para no disparar tokens sin querer.
    const reqCount = context.requirements.length || 1;
    const maxSteps = Math.min(Number(flags['max-steps']) || Math.max(12, reqCount * 3 + 4), 60);
    console.log(c.dim('    ' + t('qaBudget', maxSteps, reqCount)));
    const result = await runQaAgent({
      cfg, surface, baseUrl, plan,
      requirementIds: context.requirements,
      executor,
      maxSteps,
      language: lang === 'en' ? 'English' : 'español',
      ccr: flags.ccr === false ? false : undefined,   // CCR (compresión reversible) activo por defecto
      onStep: (r) => console.log(c.dim('    ' + t('qaStepLine', r.step, r.observation?.ok ? t('qaStepOk') : t('qaStepFail'))))
    });
    if (result.ccr) console.log(c.dim('    ' + t('qaCcrLine', result.ccr.entries, result.ccr.charsSaved)));
    const evidencePaths = [];
    const evidenceDir = join(proj, 'specs', context.id, 'qa', 'evidence');
    for (const step of result.steps || []) {
      const raw = step.observation?.screenshotBase64;
      if (!raw) continue;
      await mkdir(evidenceDir, { recursive: true });
      const file = join(evidenceDir, `step-${step.step}-failure.png`);
      await writeFile(file, Buffer.from(raw, 'base64'));
      evidencePaths.push(`evidence/${basename(file)}`);
    }
    const md = buildResultsMarkdown(context.id, { surface, baseUrl, result, evidencePaths });
    const resultsPath = qaResultsPath(proj, context.id);
    await mkdir(dirname(resultsPath), { recursive: true });   // el directorio qa/ puede no existir si no se creó plan
    await writeFile(resultsPath, md, 'utf8');
    await appendAiTrace(proj, context.id, makeAiTrace({
      task: 'qa',
      provider: cfg.provider,
      model: cfg.model,
      system: plan,
      user: `${surface} ${baseUrl}`,
      output: JSON.stringify(result.verdicts || []),
      extra: { steps: result.steps?.length || 0, ccr: result.ccr || null }
    }));
    const pass = result.verdicts.filter((v) => v.status === 'PASS').length;
    console.log(c.green('\n✓ ' + t('qaResultsSaved', qaResultsPath(proj, context.id))));
    console.log('  ' + t('qaPassSummary', pass, result.verdicts.length) + (result.error ? c.yellow(`  (${result.error})`) : ''));
    if (flags['repair-plan']) {
      const repairCfg = await resolveAiTaskConfig('repair');
      printAiLine(repairCfg);   // el modelo de repair puede diferir del de qa
      const reqTexts = Object.fromEntries(requirements(context.files['spec.md']).map((r) => [r.id.toUpperCase(), r.text]));
      const repairPath = join(proj, 'specs', context.id, 'qa', 'repair-plan.md');
      await writeFile(repairPath, buildRepairPlanMarkdown(context.id, { result, requirementTexts: reqTexts }), 'utf8');
      await appendAiTrace(proj, context.id, makeAiTrace({
        task: 'repair',
        provider: repairCfg.provider,
        model: repairCfg.model,
        system: md,
        user: 'build repair plan from QA results',
        output: repairPath,
        extra: { source: 'deterministic' }
      }));
      console.log(c.green('✓ ' + t('qaRepairPlanSaved', repairPath)));
    }

    // Web: escribe los pasos verificados como spec Playwright ejecutable y, si hay CLI, los corre (app aún viva).
    if (surface === 'web') {
      const specPath = qaAgentTestPath(proj, context.id);
      await mkdir(dirname(specPath), { recursive: true });
      const reqTexts = Object.fromEntries(requirements(context.files['spec.md']).map((r) => [r.id.toUpperCase(), r.text]));
      await writeFile(specPath, buildAgentReplaySpec(context.id, baseUrl, result.steps, reqTexts), 'utf8');
      console.log(c.green('✓ ' + t('qaReplaySpecSaved', specPath)));
      const pw = await probePlaywright(proj);
      if (pw.available) {
        console.log(c.dim('  ' + t('qaRunningPlaywright', pw.version)));
        const code = await runPlaywrightSpec(proj, specPath, baseUrl);
        if (code === 0) console.log(c.green('  ✓ ' + t('qaPlaywrightPass')));
        else {
          console.log(c.yellow('  ! ' + t('qaPlaywrightFail', code)));
          console.log(c.dim('    ' + t('qaPlaywrightInstallHint')));
        }
      } else {
        console.log(c.dim(`  ${pw.detail}`));
      }
    }
  } finally {
    if (typeof executor?.close === 'function') await executor.close();
  }
}

// ---------- comando: chalc qa ----------
// Preflight QA: specs/documentación y capacidades locales. Con --up levanta el entorno y verifica salud (luego lo baja).
async function runQa() {
  // Un solo prompter para todo el flujo interactivo (igual que spec-ia).
  const prompter = interactive ? makePrompter() : null;
  let proj = projectPath;

  // 0) Ruta del proyecto: en interactivo se pregunta (default = cwd o el argumento) y se valida.
  if (prompter && !projectArg) {
    const ans = await prompter.text(t('qaPathQ', c.dim(`[${proj}]`)));
    if (ans) proj = resolve(cleanPath(ans));
  }
  if (!existsSync(proj)) { if (prompter) prompter.close(); throw new Error(t('pathMissing', proj)); }

  console.log('\n' + c.bold('⚙️  chalc qa') + c.dim(`  ·  ${disp(proj)}`) + '\n');

  // 1) Verificar specs disponibles.
  const specs = await listSpecs(proj);
  if (!specs.length) { if (prompter) prompter.close(); throw new Error(t('qaNoSpecs')); }

  console.log(c.bold(t('qaSpecsAvailable')));
  specs.forEach((id, index) => console.log(`  ${index + 1}. ${id}`));

  const docker = await probeDocker();
  const mark = docker.installed && docker.daemon && docker.compose ? c.green('✓') : c.yellow('!');
  console.log(`\n${mark} Docker: ${docker.detail}`);

  // 2) Spec: por bandera o elegida con buscador (escribe para filtrar, ↑/↓ para moverte).
  let specId = String(flags.spec || flags.feature || '').trim();
  if (specId && !specs.includes(specId)) { if (prompter) prompter.close(); throw new Error(t('qaSpecNotFound', specId)); }
  if (prompter && !specId) {
    specId = specs[await prompter.select(t('qaWhichSpecQ'), specs.map((id) => ({ label: id })), 0, { search: true })];
  }
  if (!specId) {
    if (prompter) prompter.close();
    console.log(c.dim('\n  ' + t('qaPickSpecHint') + '\n'));
    return;
  }

  const context = await readSpecContext(proj, specId);
  if (context.duplicateRequirements.length) {
    if (prompter) prompter.close();
    throw new Error(t('qaDupRequirements', context.duplicateRequirements.join(', ')));
  }
  console.log('\n' + c.bold(t('qaSpecSelected', context.id)));
  console.log('  ' + t('qaDocs', Object.keys(context.files).join(', ')));
  console.log('  ' + t('qaRequirements', context.requirements.length ? context.requirements.join(', ') : c.yellow(t('qaNoneDetected'))));
  const environments = await findEnvironmentOptions(proj);
  console.log('  ' + t('qaEnvsDetected', environments.length ? environments.map((item) => item.label).join(', ') : c.yellow(t('qaNone'))));

  // Menú principal: el uso normal es guiado; flags solo automatizan CI.
  let qaAction = 'prepare';
  if (prompter && !flags.plan && !flags.up && !flags.agent) {
    const actions = [
      { label: t('qaActionPrepare'), value: 'prepare' },
      { label: t('qaActionRun'), value: 'run' },
      { label: t('qaActionReport'), value: 'report' }
    ];
    qaAction = actions[await prompter.select(t('qaWhatToDoQ'), actions, 0)].value;
    if (qaAction === 'report') {
      const report = qaResultsPath(proj, context.id);
      if (existsSync(report)) console.log('\n' + await readFile(report, 'utf8'));
      else console.log(c.yellow('\n! ' + t('qaNoReportYet')));
      prompter.close();
      return;
    }
  }

  // 3) Entorno: por bandera (--env, valida) o preguntado. "Decidir luego" deja el plan sin arranque fijado.
  let selectedEnv = null;
  try { selectedEnv = selectEnvironment(environments, flags.env); }   // lanza con las opciones válidas si --env no existe
  catch (e) { if (prompter) prompter.close(); throw e; }
  if (prompter && !flags.env && environments.length) {
    const choices = [...environments.map((item) => ({ label: item.label })), { label: c.dim(t('qaDecideLater')) }];
    const picked = await prompter.select(t('qaWhichEnvQ'), choices, choices.length - 1);
    selectedEnv = environments[picked] || null;
  }
  if (selectedEnv) console.log('  ' + t('qaEnvChosen', c.bold(selectedEnv.label)));
  if (selectedEnv?.type === 'compose') selectedEnv = { ...selectedEnv, projectName: qaComposeProjectName(context.id) };

  // 4) Plan: por bandera (--plan) o preguntado.
  let createPlan = !!flags.plan || qaAction === 'prepare' || qaAction === 'run';
  if (prompter && !flags.plan && qaAction !== 'prepare' && qaAction !== 'run') createPlan = await prompter.yesno(t('qaCreatePlanQ'), true);

  // 4b) Si el plan ya existe, no se machaca sin permiso (preguntado en interactivo, --force en CI).
  let overwrite = !!flags.force;
  if (createPlan && !overwrite && existsSync(qaPlanPath(proj, context.id))) {
    if (prompter) overwrite = await prompter.yesno(t('qaPlanExistsQ', context.id), false);
  }

  // 4c) Datos QA: se preguntan sin leer código. Secretos solo por NOMBRE de variable de entorno.
  let qaInputs = await readQaInputs(proj, context.id);
  if (prompter && (createPlan || !qaInputs)) {
    // Default NO: el agente ya prueba con el plan. Esto es opcional y solo afina rutas/credenciales.
    const capture = await prompter.yesno(t('qaCaptureDataQ', context.requirements.length), false);
    if (capture) {
      const perCase = await prompter.yesno(t('qaPerCaseQ'), false);
      const cases = [];
      for (const id of context.requirements) {
        if (perCase) {
          const path = await prompter.text(t('qaCasePathQ', id));
          const expected = await prompter.text(t('qaCaseExpectedQ', id));
          cases.push({ id, path, expected });
        } else {
          cases.push({ id, path: '', expected: '' });
        }
      }
      const allowedPaths = (await prompter.text(t('qaAllowedPathsQ'))).split(',').map((s) => s.trim()).filter(Boolean);
      const allowWriteMethods = await prompter.yesno(t('qaAuthorizeWritesQ'), false);
      const secretVars = (await prompter.text(t('qaSecretVarsQ'))).split(',').map((s) => s.trim()).filter(Boolean);
      qaInputs = { version: 1, cases, allowedPaths, allowWriteMethods, secretVars };
    }
  }

  // 5) Bring-up (--up) o además agente QA (--agent). Ejecuta comandos/IA: explícito. El agente necesita la app viva.
  let doAgent = !!flags.agent;
  let doUp = !!flags.up || doAgent;
  if (prompter && !flags.up && !flags.agent && selectedEnv) {
    doUp = await prompter.yesno(t('qaBringUpQ', selectedEnv.label), qaAction === 'run');
    if (doUp) doAgent = await prompter.yesno(t('qaRunAgentQ'), false);
  }
  // Si vamos a correr el agente y la app exige auth, se la PEDIMOS aquí (no fallamos en silencio).
  const qaAuth = doAgent ? await promptAuthIfNeeded(prompter, proj) : null;
  // URL de salud: con --url manda el usuario; si no, chalc LEE la URL que el server anuncia (y guess como respaldo).
  let healthCandidates = [];
  if (doUp) {
    const urlFlag = String(flags.url || '').trim();
    healthCandidates = urlFlag ? [normalizeQaUrl(urlFlag)] : await guessBaseUrls(proj);
  }
  if (!interactive && doUp && !allowExternalExec) throw new Error(t('qaNeedsExec'));
  if (prompter) prompter.close();

  if (qaInputs) {
    const inputsPath = await writeQaInputs(proj, context.id, qaInputs);
    console.log(c.green('✓ ' + t('qaInputsSaved', inputsPath)));
    const testsPath = await writeBrowserTests(proj, context, qaInputs);
    console.log(c.green('✓ ' + t('qaTestsGenerated', testsPath)));
  }

  // Plan (sin early-return: el bring-up debe poder ejecutarse después).
  if (createPlan) {
    const { path, written } = await writeQaPlan(proj, context, selectedEnv, { overwrite });
    if (written) {
      console.log(c.green('\n✓ ' + t('qaPlanCreated', path)));
      console.log(c.dim('  ' + t('qaPendingNote')));
    } else {
      console.log(c.yellow('\n! ' + t('qaPlanExists', path)));
      console.log(c.dim('  ' + t('qaForceHint')));
    }
  } else {
    console.log(c.dim('\n  ' + t('qaPreflightDone')));
  }

  if (flags['repair-plan'] && !doAgent) {
    const report = qaResultsPath(proj, context.id);
    if (!existsSync(report)) throw new Error(t('qaNoResults'));
    const result = parseResultsMarkdown(await readFile(report, 'utf8'));
    const reqTexts = Object.fromEntries(requirements(context.files['spec.md']).map((r) => [r.id.toUpperCase(), r.text]));
    const repairPath = join(proj, 'specs', context.id, 'qa', 'repair-plan.md');
    await writeFile(repairPath, buildRepairPlanMarkdown(context.id, { result, requirementTexts: reqTexts }), 'utf8');
    console.log(c.green('✓ ' + t('qaRepairPlanSaved', repairPath)));
  }

  // 6) Ejecuta el bring-up (y, si se pidió, el agente) al final, con stdin ya liberado.
  if (doUp) {
    if (!selectedEnv) console.log(c.yellow('\n! ' + t('qaNoEnvSelected')));
    else if (doAgent) {
      const { health, stop } = await startEnvironment(selectedEnv, proj, healthCandidates);
      try {
        if (health.ok) await runAgentAgainstLiveApp(context, proj, health.url, String(flags.surface || '').trim() || null, qaAuth);
        else console.log(c.yellow('  ' + t('qaAppNoResponse')));
      } finally {
        await stop();
      }
    } else {
      await bringUpEnvironment(selectedEnv, proj, healthCandidates);
      console.log(c.dim('  ' + t('qaUpHint')));
    }
  }
  console.log('');
}

// ---------- comando: chalc init ----------
// Crea un proyecto desde cero con decisión arquitectónica guiada y luego lo equipa con Chalc.
// ---------- comando: chalc lang ----------
// Fija el idioma una sola vez en ~/.chalc/config.json; se aplica a todos los proyectos sin volver a cambiarlo.
async function runConfigLang() {
  console.log('\n' + c.bold('⚙️  chalc lang') + '\n');
  console.log(c.dim('  ' + t('langCurrent', lang)));
  const opts = [{ label: t('langOptEs'), value: 'es' }, { label: t('langOptEn'), value: 'en' }];
  let code = String(positional[1] || flags.lang || '').slice(0, 2).toLowerCase();
  if (interactive && code !== 'es' && code !== 'en') {
    const prompter = makePrompter();
    code = opts[await prompter.select(t('langCmdQ'), opts, lang === 'en' ? 1 : 0)].value;
    prompter.close();
  }
  if (code !== 'es' && code !== 'en') code = lang;
  const path = saveLang(code);
  console.log(c.green('\n✓ ' + t('langSaved', path) + '\n'));
}

// Corre un paso del scaffolder/verify con salida visible. cwd: 'project' = dentro de <dest>; si no, en el padre.
function runInitStep(step, { parentDir, projectDir }) {
  return new Promise((res) => {
    const cwd = step.cwd === 'project' ? projectDir : parentDir;
    // shell:true en Windows: npx/npm/flutter son shims .cmd/.bat y spawn no los resuelve sin shell (ENOENT).
    const child = spawn(step.command, step.args, procOpts({ cwd, stdio: 'inherit', env: { ...process.env, NG_CLI_ANALYTICS: 'false' } }));
    child.on('error', (e) => res({ code: -1, error: e }));
    child.on('exit', (code) => res({ code: code ?? -1 }));
  });
}

// Lee la versión del Flutter instalado en la máquina (la que usará `flutter create`). null si no está en PATH.
function detectFlutterVersion() {
  return new Promise((res) => {
    try {
      let out = '';
      const child = spawn('flutter', ['--version'], procOpts({ stdio: ['ignore', 'pipe', 'ignore'] }));
      child.stdout.on('data', (d) => { out += d; });
      child.on('error', () => res(null));
      child.on('exit', () => { const m = out.match(/Flutter\s+(\d+\.\d+\.\d+)/i); res(m ? m[1] : null); });
    } catch { res(null); }
  });
}

// Etiqueta i18n de cada chequeo estructural (la capa de datos devuelve solo `key`).
const VERIFY_LABEL = { folders: 'vChkFolders', folderDocs: 'vChkFolderDocs', architectureDoc: 'vChkArchitectureDoc', specs: 'vChkSpecs', manifest: 'vChkManifest', assistant: 'vChkAssistant' };

// Presenta (localizado) el resultado de verifyProject: chequeos estructurales + fronteras. Devuelve si pasó.
function printVerification(result) {
  console.log('\n' + c.bold('🔎 ' + t('verifyHdr')));
  for (const ch of result.checks) {
    const extra = (!ch.ok && ch.items?.length) ? c.dim('  · ' + t('vMissing', ch.items.join(', '))) : '';
    console.log('  ' + (ch.ok ? c.green('✓') : c.yellow('✗')) + ' ' + t(VERIFY_LABEL[ch.key] || ch.key) + extra);
  }
  if (!result.violations.length) {
    console.log('  ' + c.green('✓') + ' ' + t('vBoundariesOk'));
  } else {
    console.log('  ' + c.yellow('✗') + ' ' + t('vBoundariesBad', result.violations.length));
    for (const v of result.violations.slice(0, 20)) console.log(c.dim('      · ' + t('vViolation', v.file, v.from, v.to)));
  }
  return result.ok;
}

async function runInit() {
  console.log('\n' + c.bold('⚙️  chalc init') + (dryRun ? c.dim('  (dry-run)') : '') + '\n');
  const prompter = interactive ? makePrompter() : null;
  const stacks = listStacks();

  // 1) Stack (lenguaje/framework).
  let stackId = String(positional[1] || flags.stack || '').trim().toLowerCase();
  if (prompter && !stackId) {
    // Buscador automático cuando la lista crezca (hacia "cualquier lenguaje"); con pocos, selector simple.
    stackId = stacks[await prompter.select(t('initStackQ'), stacks.map((s) => ({ label: s.label })), 0, { search: stacks.length > 6 })].id;
  }
  if (!stackId) stackId = 'angular';
  if (!getStack(stackId)) {
    if (prompter) prompter.close();
    throw new Error(t('initStackUnsupported', stackId, stacks.map((s) => s.id).join(', ')));
  }

  // 2) Nombre del proyecto.
  let projectName = slugifyProjectName(flags.name || positional[2] || '');
  if (prompter && (!projectName || projectName === 'chalc-app')) {
    projectName = slugifyProjectName(await prompter.text(t('initNameQ')));
  }
  if (!projectName) projectName = 'chalc-app';
  // Flutter/Dart exige nombre de paquete en snake_case (rechaza guiones): se aplica al nombre y a la carpeta.
  if (stackId === 'flutter') projectName = dartPackageName(projectName);

  // 2b) Ubicación: carpeta padre donde se creará <projectName>. Default = directorio actual.
  let baseDir = String(flags.dir || '').trim() ? resolve(cleanPath(String(flags.dir))) : process.cwd();
  if (prompter) {
    const ans = (await prompter.text(t('initDirQ', baseDir))).trim();
    if (ans) baseDir = resolve(cleanPath(ans));
  }

  // 3) Propuesta: texto o documento (Word/PDF/MD/TXT) → reusa la ingesta de spec-ia.
  let proposal = String(flags.description || '').trim();
  if (flags.doc) proposal = await readDocument(resolve(cleanPath(String(flags.doc))));
  if (prompter && !proposal) {
    const sources = [
      { label: t('initCtxText'), value: 'text' },
      { label: t('initCtxFile'), value: 'file' }
    ];
    const source = sources[await prompter.select(t('initContextQ'), sources, 0)].value;
    if (source === 'file') proposal = await readDocument(resolve(cleanPath(await prompter.text(t('initFileQ')))));
    else proposal = await prompter.text(t('initProposalQ'));
  }
  if (!proposal) proposal = projectName;

  // 4) Arquitectura: chalc sugiere (calibrada), el usuario decide.
  const analysis = analyzeProjectProposal(proposal);
  const suggestions = suggestArchitectures(stackId, analysis);
  let recommendedIndex = Math.max(0, suggestions.findIndex((item) => item.recommended));
  let architectureId = String(flags.architecture || '').trim();

  // 4b) IA por defecto (es la razón de ser de init): analiza la propuesta, PREGUNTA sus dudas al usuario
  // y re-analiza con las respuestas. Usa modelo económico + CCR. --no-ai la desactiva.
  let aiHint = null;
  const clarificationsQA = [];
  if (!architectureId && flags.ai !== false) {
    const cfg = await loadConfig();
    if (!isConfigured(cfg)) {
      console.log(c.dim('  ' + t('initAiNotConf')));
    } else {
      printAiLine(configForTask(cfg, 'qa'));   // init usa el modelo económico (perfil 'qa')
      console.log(c.dim('  ' + t('initAiAnalyzing')));
      try {
        aiHint = await analyzeArchitectureWithAi({ cfg, stackId, proposal, principles: MANDATORY_DESIGN_PRINCIPLES, language: lang === 'en' ? 'English' : 'español' });

        // Las dudas del LLM se le PREGUNTAN al usuario (no se dejan pasar) y se re-analiza con las respuestas.
        if (prompter && aiHint.clarifications?.length) {
          console.log('\n  ' + c.bold(t('initAiClarifyHdr')) + c.dim('  ' + t('initAiClarifyHint')));
          for (const q of aiHint.clarifications) {
            const a = (await prompter.text(`  ${q}`)).trim();
            if (a) clarificationsQA.push({ q, a });
          }
          if (clarificationsQA.length) {
            proposal += '\n\n' + (lang === 'en' ? 'User clarifications' : 'Aclaraciones del usuario') + ':\n' + clarificationsQA.map((x) => `- ${x.q} → ${x.a}`).join('\n');
            console.log(c.dim('  ' + t('initAiReanalyzing')));
            aiHint = await analyzeArchitectureWithAi({ cfg, stackId, proposal, principles: MANDATORY_DESIGN_PRINCIPLES, language: lang === 'en' ? 'English' : 'español' });
          }
        } else if (aiHint.clarifications?.length) {
          console.log(c.dim('  ' + t('initAiPending', aiHint.clarifications.join(' · '))));
        }

        const idx = suggestions.findIndex((s) => s.id === aiHint.architectureId);
        if (idx >= 0) recommendedIndex = idx;
        const recLabel = archText(suggestions.find((s) => s.id === aiHint.architectureId)?.label) || aiHint.architectureId;
        console.log('\n' + c.bold(t('initAiSuggestion')) + c.dim(aiHint.source === 'fallback' ? '  ' + t('initAiFallback') : ''));
        console.log(`  ${t('initAiArch')}: ${c.bold(recLabel)}`);
        if (aiHint.reasoning) console.log(`  ${t('initAiWhy', aiHint.reasoning)}`);
        if (aiHint.ccr) console.log(c.dim('  ' + t('initAiCcr', aiHint.ccr.entries, aiHint.ccr.charsSaved)));
        console.log(c.dim('  ' + t('initHumanDecision')));
      } catch (e) { console.log(c.yellow('  ! ' + t('initAiFailed', e.message))); }
    }
  }

  if (prompter && !architectureId) {
    console.log('\n' + c.bold(t('initReadingHdr')));
    console.log(`  ${t('initTypeL')}: ${localizeType(analysis.typeKey)}`);
    console.log(`  ${t('initCxL')}: ${localizeComplexity(analysis.complexity)}`);
    console.log(`  ${t('initSignalsL')}: ${analysis.signals.length ? analysis.signals.join(', ') : t('initNoSignals')}`);
    if (analysis.missing.length) console.log(c.dim('  ' + t('initPending', analysis.missing.join(', '))));
    console.log(c.dim('\n  ' + t('initPrinciplesAlways') + '\n'));
    const idx = await prompter.select(t('initArchQ'), suggestions.map((item) => ({
      label: `${archText(item.label)}${item.recommended ? ' (' + t('initRecommended') + ')' : ''}${aiHint && aiHint.architectureId === item.id ? ' ★ IA' : ''} — ${archText(item.fit)}`
    })), recommendedIndex);
    architectureId = suggestions[idx].id;
  }
  if (!architectureId) architectureId = suggestions[recommendedIndex].id;
  const decision = buildArchitectureDecision({ stack: stackId, proposal, architectureId: architectureId || suggestions[recommendedIndex].id, clarifications: clarificationsQA });

  // 5) Target (asistente de IA).
  let targetName = String(flags.target || 'claude');
  const targetOptions = (await loadTargets()).map((tgt) => ({ label: tgt.label, value: tgt.id }));
  if (prompter) {
    const di = Math.max(0, targetOptions.findIndex((o) => o.value === targetName));
    targetName = targetOptions[await prompter.select(t('initAssistantQ'), targetOptions, di)].value;
  }
  targetName = assertSafeId(targetName, 'target');

  const dest = resolve(baseDir, projectName);
  const parentDir = dirname(dest);
  const steps = scaffoldSteps(stackId, decision.architecture.id, projectName);
  const doVerify = !!flags.verify;

  console.log('\n' + c.bold(t('initSummary')));
  console.log(`  ${t('initSumProject')}: ${dest}`);
  console.log(`  ${t('initSumStack')}: ${decision.stackLabel}`);
  console.log(`  ${t('initSumArch')}: ${archText(decision.architecture.label)}`);
  console.log(`  ${t('initSumScaffolder')}: ${steps.map((s) => `${s.command} ${s.args.slice(0, 4).join(' ')}…`).join(' · ')}`);
  const tool = resolveScaffoldTool(stackId);
  if (tool) {
    const node = process.version.replace(/^v/, '');
    const pinned = tool.tag !== 'latest';
    console.log(`  ${t('initSumToolchain')}: ${tool.pkg}@${tool.tag}` + (pinned ? c.dim('  · ' + t('initToolPinned', node)) : ''));
  }
  // Flutter usa el SDK instalado en tu máquina: mostramos esa versión (o avisamos si no está en PATH).
  if (stackId === 'flutter') {
    const fv = await detectFlutterVersion();
    console.log(`  ${t('initSumToolchain')}: ` + (fv ? `flutter ${fv}` + c.dim('  · ' + t('initFlutterLocal')) : c.yellow(t('initFlutterMissing'))));
  }
  console.log(`  ${t('initSumPrinciples')}: ${decision.mandatoryPrinciples.slice(0, 4).join(', ')} ${t('initSumAlways')}`);
  console.log(`  ${t('initSumTarget')}: ${targetName}${doVerify ? c.dim('  · ' + t('initWithVerify')) : ''}`);
  if (prompter) {
    const ok = await prompter.yesno(dryRun ? t('initConfirmDry') : t('initConfirmCreate'), true);
    prompter.close();
    if (!ok) { console.log(c.dim('\n' + t('cancelled') + '\n')); return; }
  }

  if (dryRun) {
    console.log(c.dim('\n' + t('initDryHdr')));
    steps.forEach((s) => console.log(c.dim(`  ▶ ${s.command} ${s.args.join(' ')}`)));
    console.log(c.dim(`  ▶ ${t('initDryFolders')}`));
    console.log(c.dim(`  ▶ ${t('initDryEquip', targetName, doVerify)}\n`));
    return;
  }

  if (existsSync(dest)) throw new Error(t('initExists', dest));
  if (!interactive && !allowExternalExec) throw new Error(t('initNeedsExec'));

  // 6) Scaffolder oficial (ng new / nest new / dotnet new). Aseguramos la carpeta padre (cwd del scaffolder).
  // Solo si no existe: en Windows, mkdir sobre la raíz del disco (p. ej. D:\, padre de D:\prueba) lanza EPERM.
  if (!existsSync(parentDir)) await mkdir(parentDir, { recursive: true });
  if (steps.some((s) => s.cwd === 'project')) await mkdir(dest, { recursive: true });
  for (const step of steps) {
    console.log('\n▶ ' + c.bold(step.label) + c.dim(`  · ${step.command} ${step.args.join(' ')}`));
    const r = await runInitStep(step, { parentDir, projectDir: dest });
    if (r.code !== 0) throw new Error(t('initScaffoldFail', step.label, r.error?.code || r.error?.message || t('scaffoldExitCode', r.code), step.command));
  }
  if (!existsSync(dest)) throw new Error(t('initScaffoldNoDir', dest));

  // 7) Re-moldear a la arquitectura + documentar la decisión.
  const reshaped = await reshapeProject(dest, decision);

  // 8) Equipar (mismo motor que `apply`): stack + principios globales + skills propias de la arquitectura.
  const extraSkills = architectureSkills(stackId, decision.architecture.id);
  const equipped = await equipCreatedProject(dest, { targetName, methodMode: 'lite', extraSkills, architecture: { name: archText(decision.architecture.label) } });

  console.log('\n' + c.green('✓ ' + t('initCreated', dest)));
  console.log(c.dim('  ' + t('initFolders', reshaped.folders.join(', '))));
  console.log(c.green('✓ ' + t('initEquipped', equipped.skills.length, equipped.mcps.length, equipped.methods.length, targetName)));
  console.log(c.dim('  ' + t('initEquipNote')));

  // 9) Verificación determinista (sin tokens): ¿está todo en su sitio y respeta las fronteras?
  const verification = await verifyProject(dest, { expectFolders: reshaped.folders, target: targetName });
  const verifiedOk = printVerification(verification);

  // 10) Build check opcional (--verify).
  if (doVerify) {
    for (const step of verifySteps(stackId)) {
      console.log('\n▶ ' + c.bold(t('initVerifyStep', step.label)) + c.dim(`  · ${step.command} ${step.args.join(' ')}`));
      const r = await runInitStep({ ...step, cwd: 'project' }, { parentDir, projectDir: dest });
      if (r.code !== 0) { console.log(c.yellow('  ' + t('initVerifyFail', step.label, r.code))); break; }
    }
    console.log(c.green('\n✓ ' + t('initVerifyDone')));
  }

  // 11) Cierre.
  console.log('\n' + (verifiedOk ? c.green('✓ ' + t('initCreatedOk')) : c.yellow('! ' + t('initCreatedWarn'))));
  console.log(c.dim('  ' + t('initNextStep', projectName) + '\n'));
}

// ---------- comando: chalc verify / check (verifica un proyecto existente) ----------
// Determinista, sin tokens: completitud estructural + linter de fronteras. `--strict` sale con código 1 (CI).
async function runVerify() {
  const proj = resolve(cleanPath(String(positional[1] || flags.path || '.')));
  console.log('\n' + c.bold('⚙️  ' + t('checkHdr')) + c.dim('  ·  ' + proj) + '\n');
  if (!existsSync(proj)) { console.log(c.red('✗ ' + t('pathMissing', proj))); process.exit(1); }
  const verification = await verifyProject(proj);
  const ok = printVerification(verification);
  const findings = verification.checks.filter((ch) => !ch.ok).length + verification.violations.length;
  console.log('\n' + (ok ? c.green('✓ ' + t('checkOk')) : c.yellow('! ' + t('checkFindings', findings))) + '\n');
  if (!ok && flags.strict) process.exit(1);
}

// ---------- comando: chalc configure ----------
async function runConfigure() {
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

// ---------- comando: chalc (apply) ----------
async function runApply() {
  let proj = projectPath;
  const prompter = interactive ? makePrompter() : null;

  // Valida una ruta candidata; devuelve null si es válida, o una función que imprime el error.
  const validatePath = async (p) => {
    if (p === CHALC_ROOT) return () => console.log(c.yellow('• ' + t('notChalcFolder')));
    if (!existsSync(p)) return () => console.log(c.red('✗ ' + t('pathMissing', p)));
    try { await access(p, constants.W_OK); } catch {
      return () => {
        console.log(c.red('✗ ' + t('pathNotWritable', p)));
        console.log(c.dim(`  sudo chown -R "$(whoami)" "${p}"`));
      };
    }
    return null;
  };

  // 0) ruta del proyecto: en interactivo se pregunta y se re-pregunta hasta que sea válida
  if (prompter) {
    console.log('\n' + c.bold('⚙️  chalc') + (dryRun ? c.dim('  (dry-run)') : '') + '\n');
    console.log(c.dim('  ' + t('pathHint')));
    while (true) {
      const def = proj === CHALC_ROOT ? '' : proj;     // no ofrecer la carpeta de chalc como default
      const ans = await prompter.text(`${t('pathQ')} ${def ? c.dim(`[${def}]`) : ''}:`);
      const candidate = ans ? resolve(cleanPath(ans)) : (def ? proj : CHALC_ROOT);
      const err = await validatePath(candidate);
      if (err) { err(); continue; }
      proj = candidate;
      break;
    }
  } else {
    console.log('\n' + c.bold('⚙️  chalc') + c.dim(`  ·  ${disp(proj)}`) + (dryRun ? c.dim('  (dry-run)') : '') + '\n');
    const err = await validatePath(proj);
    if (err) { err(); process.exit(1); }
  }
  console.log(c.dim(`  ${t('project')}: ${disp(proj)}`));

  // 1) detectar
  const ctx = await detectContext(proj);
  const rules = await loadJsonDir(RULES_DIR);
  const matched = matchRules(rules, ctx);
  const stacks = matched.filter((r) => !r.always);          // para mostrar (Global no es un stack)
  const langs = [...new Set(stacks.map((r) => r.language).filter(Boolean))];
  if (stacks.length) {
    console.log(c.green('✓ ') + c.bold(stacks.map((r) => r.name).join(' + ')) + (langs.length ? c.dim('   ·   ' + langs.join(', ')) : '') + '\n');
  } else {
    console.log(c.yellow('• ' + t('noStack')) + '\n');
  }

  // 2) asistente destino (solo los que existen en targets/)
  const targetOptions = (await loadTargets()).map((t) => ({ label: t.label, value: t.id }));
  let targetName = String(flags.target || 'claude');
  if (prompter) {
    const di = Math.max(0, targetOptions.findIndex((o) => o.value === targetName));
    targetName = targetOptions[await prompter.select(t('assistantQ'), targetOptions, di)].value;
  }
  targetName = assertSafeId(targetName, 'target');
  const targetFile = join(TARGETS_DIR, `${targetName}.mjs`);
  if (!existsSync(targetFile)) {
    if (prompter) prompter.close();
    console.error(c.red('✗ ' + t('targetMissing', targetName))); process.exit(1);
  }

  // 3) equipar skills + mcp (de las reglas que matchean, incluida la global)
  let skills = [];
  let mcpIds = [];
  if (matched.length) {
    let equip = true;
    if (prompter) equip = await prompter.yesno(t('equipQ', stacks.map((r) => r.name).join(' + ') || t('thisProject')), true);
    if (equip) {
      skills = [...new Set(matched.flatMap((r) => r.skills || []))];
      mcpIds = [...new Set(matched.flatMap((r) => r.mcp || []))];
      const optionalIds = [...new Set(matched.flatMap((r) => r.optionalMcp || []))].filter((id) => !mcpIds.includes(id));
      for (const id of optionalIds) {
        const def = await loadMcp(id);
        if (prompter && await prompter.yesno(t('optionalMcpQ', c.bold(id), def.description), false)) mcpIds.push(id);
      }
    }
  }

  // 4) instalar skills nuevos desde URL (interactivo) — los cablea a una regla y los equipa ya
  if (prompter) {
    while (await prompter.yesno(t('installNewQ'), false)) {
      const src = cleanPath(await prompter.text('  ' + t('sourceQ')));
      if (!src) break;
      try {
        const installed = await installSkill({ source: src, CATALOG, prompter, force, allowExternalExec, log: (m) => console.log(c.dim('  ' + m)) });
        console.log(c.green('  ✓ ' + t('installedOk', installed.join(', '))));
        for (const id of installed) {
          await associate(prompter, rules, id);
          if (!skills.includes(id)) skills.push(id);     // equiparlo también en ESTE proyecto
        }
      } catch (e) { console.log(c.red('  ✗ ' + e.message)); }
    }
  }

  // 5) métodos (SDD, etc.) — explicador + modo
  const methods = [];
  for (const m of await loadMethods()) {
    const flagEntry = methodFlags.find((f) => f === m.id || f.startsWith(m.id + ':'));
    let want = !!flagEntry;
    if (prompter) want = await prompter.yesno(t('methodQ', c.bold(m.label), m.description), false);
    if (!want) continue;
    if (prompter && m.explainText) {
      console.log(c.cyan(m.explainText));
      if (!await prompter.yesno(t('methodConfirm'), true)) { console.log(c.dim('  · ' + t('methodSkipped') + '\n')); continue; }
    }
    let mode = m.modes[0];
    if (m.modes.length > 1) {
      if (prompter) mode = m.modes[await prompter.select(t('sizeQ'), m.modes.map((x) => ({ label: x.label })), 0)];
      else if (flagEntry && flagEntry.includes(':')) mode = m.modes.find((x) => x.id === flagEntry.split(':')[1]) || mode;
      else if (flags.mode) mode = m.modes.find((x) => x.id === String(flags.mode)) || mode;
    }
    methods.push({ id: m.id, label: m.label, mode: mode.id, scaffoldDir: mode.scaffoldDir, rulesText: mode.rulesText });
  }

  // 6) confirmar
  if (prompter) {
    console.log('\n' + c.bold(t('summary')));
    console.log(`  ${t('sAssistant')} : ${targetName}`);
    console.log(`  ${t('sSkills')} : ${skills.length}`);
    console.log(`  ${t('sMcp')} : ${mcpIds.length ? mcpIds.join(', ') : '—'}`);
    console.log(`  ${t('sMethods')} : ${methods.length ? methods.map((m) => `${m.id} (${m.mode})`).join(', ') : '—'}\n`);
    const go = await prompter.yesno(dryRun ? t('showQ') : t('applyQ'), true);
    prompter.close();
    if (!go) { console.log(c.dim('\n' + t('cancelled') + '\n')); process.exit(0); }
  }

  // 7) resolver mcp y aplicar
  const mcps = await Promise.all(mcpIds.map(async (id) => {
    const def = await loadMcp(id);
    return { id: def.id, description: def.description, server: deepSub(def.server, { PROJECT: proj }) };
  }));
  const target = await import(pathToFileURL(targetFile).href);
  const { plan } = await target.apply({ projectPath: proj, CATALOG, skills, mcps, methods, stacks, dryRun });

  console.log('\n' + c.bold(dryRun ? t('planDry') : t('applied')));
  for (const line of plan) console.log('  ' + (dryRun ? c.dim('· ') : c.green('✓ ')) + line);
  if (!dryRun) {
    console.log('\n' + c.green(t('done', skills.length, mcps.length, methods.length, target.label || targetName)));
    console.log(c.dim(t('manifest', join(basename(proj), '.chalc.json')) + '\n'));
  } else {
    console.log('\n' + c.dim(t('removeDryrun') + '\n'));
  }
}

// Muestra qué proveedor/modelo de IA se usará (para que el usuario sepa si está sobre Ollama local, nube, etc.).
function printAiLine(cfg) {
  if (!cfg?.provider) return;
  const prov = PROVIDERS[cfg.provider];
  const base = cfg.baseURL || prov?.baseURL || '';
  const local = prov && !prov.needsKey;   // ollama u otro local: mostramos también el endpoint
  console.log(c.dim('  ' + t('aiActiveLine', cfg.provider, cfg.model || prov?.defaultModel || '?')) + (local && base ? c.dim(`  · ${base}`) : '')) ;
}

// ---------- configuración de la IA (solo para generar specs SDD) ----------
// Reutilizable: la usa `chalc spec-ai` y también `chalc spec-gen` si aún no hay config.
async function configureAi(prompter) {
  console.log(c.dim('  ' + t('aiIntro')) + '\n');
  const cfg = await loadConfig();
  const profiles = await listAiProfiles();
  const ids = Object.keys(PROVIDERS);
  const di = Math.max(0, ids.indexOf(cfg.provider));
  const provider = ids[await prompter.select(t('aiProviderQ'), ids.map((id) => ({ label: `${id} — ${PROVIDERS[id].label}` })), di)];
  const prov = PROVIDERS[provider];
  const out = { provider };
  if (profiles.length) {
    const profileIds = profiles.map((p) => p.id);
    const defaultProfile = String(flags.profile || cfg.profile || 'chalc-default');
    const pIndex = Math.max(0, profileIds.indexOf(defaultProfile));
    const picked = profiles[await prompter.select(t('aiProfileQ'), profiles.map((p) => ({ label: `${p.id} — ${p.description || t('aiNoDesc')}` })), pIndex)];
    out.profile = picked.id;
  }
  if (prov.needsBaseURL) out.baseURL = (await prompter.text(t('aiBaseUrlQ') + ':')).trim() || cfg.baseURL || '';
  if (prov.needsKey) out.apiKey = (await prompter.secret(t('aiKeyQ') + ':')) || cfg.apiKey || '';
  else console.log(c.dim('  ' + t('aiNoKeyNeeded')));
  // Para providers locales (Ollama, LM Studio…) listamos los modelos REALMENTE instalados y dejamos elegir,
  // en vez de pedir texto libre con un default que puede no existir y reventar al llamar.
  const installed = prov.needsKey ? [] : await listModels({ provider, baseURL: out.baseURL });
  if (installed.length) {
    const otherIdx = installed.length;
    const di = Math.max(0, installed.indexOf(cfg.model));
    const pick = await prompter.select(t('aiModelPickQ'), [...installed.map((m) => ({ label: m })), { label: t('aiModelOther') }], di);
    out.model = pick < otherIdx ? installed[pick] : ((await prompter.text(t('aiModelQ', installed[0]) + ':')).trim() || cfg.model || installed[0]);
  } else {
    if (!prov.needsKey) console.log(c.dim('  ' + t('aiModelListEmpty')));
    const modelQ = prov.needsDeployment ? t('aiDeploymentQ') : t('aiModelQ', prov.defaultModel);
    out.model = (await prompter.text(modelQ + ':')).trim() || cfg.model || prov.defaultModel;
  }
  const profile = await loadAiProfile(out.profile || 'chalc-default');
  // En providers locales NO arrastramos modelos por tarea previos (podrían ser un default obsoleto tipo llama3.1
  // que pisa el modelo que el usuario acaba de elegir); el modelo elegido manda salvo que pida personalizar.
  const baseModels = prov.needsKey ? (cfg.models || {}) : {};
  const profiled = applyProfileModels({ ...out, models: baseModels }, profile);
  // Los modelos por tarea vienen del perfil; se afinan APARTE con `config-ia spec|qa|repair` (por paquetes:
  // este wizard base solo configura proveedor + key + modelo — no interroga por cosas que no vas a usar).
  out.models = { ...(profiled.models || {}) };
  if (provider === 'azure') out.apiVersion = (await prompter.text(t('aiVersionQ', '2024-10-21') + ':')).trim() || cfg.apiVersion || '2024-10-21';
  // Merge sobre la config existente: config-ia solo gobierna SUS claves — lang, cli.* y cualquier otra
  // preferencia guardada en ~/.chalc/config.json deben sobrevivir a una reconfiguración.
  const merged = { ...cfg, ...out };
  if (!prov.needsKey) delete merged.apiKey;   // provider local: no persistir una key heredada del entorno
  const path = await saveConfig(merged);
  console.log('\n' + c.green('✓ ' + t('aiSaved', path)));
  console.log(c.dim(`  ${provider} · default ${out.model} · spec ${out.models?.spec || out.model} · qa ${out.models?.qa || out.model}${out.apiKey ? ' · key ' + out.apiKey.slice(0, 4) + '…' : ''}`));
  console.log(c.dim('  ' + t('aiScopesTip')));
  console.log('');
  return out;
}

// Selector de UN modelo sobre un proveedor dado: lista los instalados si es local (flechas + "otro
// nombre…"); texto libre con default si es cloud. Reutilizado por los paquetes cli/spec/qa/repair.
async function pickModelOn(prompter, { provider, baseURL, label, current }) {
  const prov = PROVIDERS[provider];
  const installed = prov?.needsKey ? [] : await listModels({ provider, baseURL });
  if (installed.length) {
    const mi = Math.max(0, installed.indexOf(current));
    const pick = await prompter.select(label, [...installed.map((m) => ({ label: m })), { label: t('aiModelOther') }], mi);
    return pick < installed.length ? installed[pick] : ((await prompter.text(t('aiModelQ', current) + ':')).trim() || current);
  }
  return (await prompter.text(label + ` [${current}]:`)).trim() || current;
}

// ---------- chalc config-ia cli — el EQUIPO de la shell: líder / desarrollador / revisor ----------
// Pregunta solo lo del cli, con nombres entendibles y una línea que explica qué hace cada rol.
// Cada rol puede quedarse en el proveedor base (se guarda el nombre del modelo) o irse a otro
// proveedor con su propia key ({provider, model, apiKey}).
async function configureAiRoles(prompter) {
  const cfg = await loadConfig();
  if (!isConfigured(cfg)) { console.error(c.red('✗ ' + t('aiNotBaseConfigured'))); return; }
  console.log(c.dim('  ' + t('aiRolesIntro')) + '\n');
  const ids = Object.keys(PROVIDERS);
  const provider = cfg.provider;
  const prevRoles = cfg.cli?.roles || {};
  const roleKeys = {};   // keys ya tecleadas por proveedor en ESTA pasada: no pedir la misma 3 veces
  const roles = {};
  // Mini-banner por agente: ícono + nombre en su color + regla, y la descripción desplegada debajo
  // (partida en sus frases) — que se LEA quién es antes de preguntar dónde corre y con qué modelo.
  const ICONS = { planner: '🧠', coder: '⚙️ ', reviewer: '🔍' };
  const PAINT = { planner: c.cyan, coder: c.green, reviewer: c.yellow };
  for (const role of ['planner', 'coder', 'reviewer']) {
    const name = t('aiRoleShort', role);
    const title = t('aiTeamName', role);
    console.log('\n  ' + c.dim('──') + ' ' + ICONS[role] + ' ' + PAINT[role](c.bold(title)) + ' ' + c.dim('─'.repeat(Math.max(6, 46 - title.length))));
    for (const line of t('aiRoleDesc', role).split('; ')) console.log('     ' + c.dim(line.trim()));
    console.log('');
    const prev = prevRoles[role];
    const prevObj = prev && typeof prev === 'object' ? prev : null;
    const others = ids.filter((id) => id !== provider);
    const where = await prompter.select(t('aiRoleWhereQ', name), [
      { label: t('aiRoleSameProv', provider) },
      ...others.map((id) => ({ label: `${id} — ${PROVIDERS[id].label}` }))
    ], prevObj ? Math.max(0, others.indexOf(prevObj.provider) + 1) : 0);
    if (where === 0) {
      roles[role] = await pickModelOn(prompter, {
        provider, baseURL: cfg.baseURL,
        label: t('aiRoleModelQ', name), current: (typeof prev === 'string' && prev) || cfg.model
      });
      continue;
    }
    const rid = others[where - 1];
    const rprov = PROVIDERS[rid];
    const saved = prevObj?.provider === rid ? prevObj : {};   // reconfigurar conserva key/modelo previos del MISMO proveedor
    const entry = { provider: rid };
    if (rprov.needsBaseURL) entry.baseURL = (await prompter.text(t('aiBaseUrlQ') + ':')).trim() || saved.baseURL || '';
    if (rprov.needsKey) {
      const reuse = roleKeys[rid] || saved.apiKey || (rid === cfg.provider ? cfg.apiKey : '') || '';
      entry.apiKey = (await prompter.secret(t('aiRoleKeyQ', rid) + ':')) || reuse;
      roleKeys[rid] = entry.apiKey;
    }
    entry.model = await pickModelOn(prompter, {
      provider: rid, baseURL: entry.baseURL,
      label: t('aiRoleModelQ', name), current: saved.model || rprov.defaultModel
    });
    roles[role] = entry;
  }
  const path = await saveConfig({ ...cfg, cli: { ...(cfg.cli || {}), roles } });
  console.log('\n' + c.green('✓ ' + t('aiSaved', path)));
  printTeam(roles, cfg);
}

// Tarjeta GRÁFICA del equipo (líder → desarrollador → revisor): al cerrar la config, el usuario ve de
// un vistazo quién es quién, con qué modelo y dónde corre (nube ☁ / local ⌂) — no una línea de texto.
function printTeam(roles, cfg) {
  const bar = (s = '') => console.log('   ' + c.dim('│') + (s ? '  ' + s : ''));
  const icons = { planner: '🧠', coder: '⚙️ ', reviewer: '🔍' };
  const paint = { planner: c.cyan, coder: c.green, reviewer: c.yellow };
  const where = (provider) => {
    const cloud = PROVIDERS[provider]?.needsKey;
    return c.dim((cloud ? '☁  ' : '⌂  ') + t(cloud ? 'aiTeamCloud' : 'aiTeamLocal', provider));
  };
  console.log('\n   ' + c.dim('╭──── ') + c.bold(t('aiTeamTitle')) + c.dim(' ────────────────────────'));
  bar();
  for (const role of ['planner', 'coder', 'reviewer']) {
    const v = roles[role];
    if (!v) continue;
    const model = typeof v === 'string' ? v : v.model;
    const provider = typeof v === 'string' ? cfg.provider : v.provider;
    bar(`${icons[role]} ${paint[role](c.bold(t('aiTeamName', role)))}  ${c.bold(model)}`);
    bar(`   ${where(provider)}`);
    bar(`   ${c.dim(t('aiRoleDesc', role))}`);
    if (role !== 'reviewer') bar(c.dim('      ↓'));
  }
  bar();
  console.log('   ' + c.dim('╰──────────────────────────────────────────────') + '\n');
}

// ---------- chalc config-ia spec|qa|repair — el modelo de UNA tarea, sin interrogatorio ----------
const AI_TASK_LABELS = { spec: 'spec-ia', qa: 'qa --agent', repair: 'repair-plan' };
async function configureAiTask(prompter, task) {
  const cfg = await loadConfig();
  if (!isConfigured(cfg)) { console.error(c.red('✗ ' + t('aiNotBaseConfigured'))); return; }
  const label = AI_TASK_LABELS[task];
  console.log(c.dim('  ' + t('aiTaskIntro', label)) + '\n');
  const current = cfg.models?.[task] || cfg.model;
  const model = await pickModelOn(prompter, {
    provider: cfg.provider, baseURL: cfg.baseURL,
    label: t('aiModelForTask', label, current), current
  });
  const path = await saveConfig({ ...cfg, models: { ...(cfg.models || {}), [task]: model } });
  console.log('\n' + c.green('✓ ' + t('aiSaved', path)));
  console.log(c.dim(`  ${label} → ${model}`) + '\n');
}

// ---------- comando: chalc config-ia [cli|spec|qa|repair|doctor] — por PAQUETES ----------
// Sin argumento: solo lo base (proveedor + key + modelo). Cada paquete pregunta ÚNICAMENTE lo suyo:
// `cli` el equipo líder/desarrollador/revisor de la shell; `spec|qa|repair` el modelo de esa tarea.
async function runAi() {
  const scope = positional[1];
  console.log('\n' + c.bold('⚙️  chalc config-ia' + (scope && scope !== 'doctor' ? ' ' + scope : '')) + '\n');
  if (flags.doctor || scope === 'doctor') return runAiDoctor();
  if (!interactive) { console.error(c.red('✗ ' + t('aiNeedsTty'))); process.exit(1); }
  const prompter = makePrompter();
  if (scope === 'cli') await configureAiRoles(prompter);
  else if (AI_TASK_LABELS[scope]) await configureAiTask(prompter, scope);
  else await configureAi(prompter);
  prompter.close();
}

async function runAiDoctor() {
  console.log('\n' + c.bold('⚙️  chalc ai-doctor') + '\n');
  let cfg = await loadConfig();
  const profile = await loadAiProfile(String(flags.profile || cfg.profile || 'chalc-default'));
  cfg = applyProfileModels(cfg, profile);
  if (!isConfigured(cfg)) {
    console.log(c.red('✗ ' + t('aiDoctorNotConfigured')));
    process.exit(1);
  }
  const prov = PROVIDERS[cfg.provider];
  console.log(`  ${t('aiDoctorProvider').padEnd(9)} : ${cfg.provider} — ${prov.label}`);
  console.log(`  ${t('aiDoctorBaseUrl').padEnd(9)} : ${cfg.baseURL || prov.baseURL}`);
  console.log(`  ${t('aiDoctorProfile').padEnd(9)} : ${cfg.profile || '—'}`);
  console.log(`  ${t('aiDoctorModels').padEnd(9)} : spec=${modelForTask(cfg, 'spec')} · qa=${modelForTask(cfg, 'qa')} · repair=${modelForTask(cfg, 'repair')}`);
  if (prov.needsKey && cfg.apiKey) console.log(`  ${t('aiDoctorApiKey').padEnd(9)} : ${cfg.apiKey.slice(0, 4)}…${cfg.apiKey.slice(-2)}`);
  console.log(c.green('\n✓ ' + t('aiDoctorConsistent')));
  console.log(c.dim('  ' + t('aiDoctorLiveHint') + '\n'));
}

async function runAiEval() {
  console.log('\n' + c.bold('⚙️  chalc eval-ia') + c.dim('  ·  local') + '\n');
  const checks = runLocalAiEvals();
  for (const check of checks) {
    const mark = check.ok ? c.green('✓') : c.red('✗');
    console.log(`  ${mark} ${check.name}${check.error ? c.dim(` — ${check.error}`) : ''}`);
  }
  const failed = checks.filter((x) => !x.ok);
  console.log(`\n  ${t('aiEvalSummary', checks.length - failed.length, checks.length)}\n`);
  if (failed.length) process.exit(1);
}

// ---------- comando: chalc spec-gen (documento → SDD con IA) ----------
function readPasted() {
  return new Promise((resolve) => {
    const rl = createInterface({ input: stdin, output: stdout });
    const lines = [];
    rl.on('line', (l) => { if (l.trim() === 'END') rl.close(); else lines.push(l); });
    rl.on('close', () => resolve(lines.join('\n')));
  });
}

// La numeración e idempotencia de carpetas de spec vive en lib/specfolder.mjs (resolveFeatureFolder).

// Nombre de idioma para el spec: mapea códigos comunes (es→español), o usa el texto tal cual.
function langName(v) {
  const map = { es: 'español', en: 'English', pt: 'português', fr: 'français', de: 'Deutsch', it: 'italiano' };
  return map[String(v).toLowerCase()] || v;
}

function handoffCommand(specPath, skills = [], specLang = '', opts = {}) {
  // El hand-off sigue el idioma del SPEC (lo que elegiste con --lang), no el del CLI.
  const code = String(specLang).toLowerCase();
  const isEs = /espa|spanish|castell/.test(code) || code === 'es' || (!specLang && lang === 'es');
  const en = !isEs;
  // Skills bajo demanda: no volcamos la lista completa (eso dispersa el foco). Decimos dónde están
  // y que abra solo la que necesita la tarea activa. `skills` se conserva por compatibilidad de firma.
  void skills;
  const skillsLine = en
    ? `Use the project's skills when a task needs one (they live in .claude/skills or .chalc/skills) — open only the one the current task needs, don't preload them all.`
    : `Usa las skills del proyecto cuando una tarea lo pida (están en .claude/skills o .chalc/skills); abre solo la que necesita la tarea activa, no las pre-cargues todas.`;
  // Rama de la feature. Si chalc ya la creó (opts.branchCreated) el paso 1 lo refleja; si no, pide crearla.
  // opts.branch fija el nombre exacto (para coincidir con el que creó chalc); por defecto feature/<NNN-nombre>.
  const branch = opts.branch || ('feature/' + specPath.replace(/^specs[/\\]/, ''));
  const step1 = opts.branchCreated
    ? (en ? `1. You're already on branch \`${branch}\` (chalc created it) — commit your work there.` : `1. Ya estás en la rama \`${branch}\` (la creó chalc) — commitea tu trabajo ahí.`)
    : (en ? `1. Create a branch for this feature (one branch per spec): \`git checkout -b ${branch}\`.` : `1. Crea una rama para esta feature (una rama por spec): \`git checkout -b ${branch}\`.`);
  if (en) {
    return [
      `Implement the feature in \`${specPath}/\` using Spec-Driven Development with strict TDD.`,
      ``,
      step1,
      `2. First read \`specs/constitution.md\` (non-negotiable principles) and \`${specPath}/spec.md\` (the EARS requirements R1, R2…).`,
      `3. Follow \`${specPath}/plan.md\` (architecture & decisions) and execute \`${specPath}/tasks.md\` in order, ONE task at a time: before each task state which R# it implements; when it's done, stop and wait for my OK before the next.`,
      `4. For each task, strict TDD: write the failing test first (Red) → minimum code to pass (Green) → refactor. Never write code without a failing test first.`,
      `5. Every test and file traces to its requirement (R#).`,
      `6. ${skillsLine} Respect "one thing per file" (interfaces / DTOs / types each in its own file).`,
      `7. Tooling/tests: use the test framework the project ALREADY has; don't invent config. If tooling is missing, the registry is private, or something won't compile, report it as a blocker and ask me — don't improvise or switch tools on your own.`,
      `8. If a requirement is marked [NEEDS CLARIFICATION], ask me before implementing it.`,
      `The spec is the source of truth: if scope changes, update the spec first.`
    ].join('\n');
  }
  return [
    `Implementa la feature en \`${specPath}/\` con Spec-Driven Development y TDD estricto.`,
    ``,
    step1,
    `2. Lee primero \`specs/constitution.md\` (principios no negociables) y \`${specPath}/spec.md\` (los requisitos R1, R2… en EARS).`,
    `3. Sigue \`${specPath}/plan.md\` (arquitectura y decisiones) y ejecuta \`${specPath}/tasks.md\` en orden, UNA tarea a la vez: antes de cada tarea di qué R# implementa; al terminarla, párate y espera mi OK antes de la siguiente.`,
    `4. Por cada tarea, TDD estricto: escribe el test que falla primero (Red) → el mínimo código para pasarlo (Green) → refactoriza. Nunca escribas código sin un test que falle primero.`,
    `5. Cada test y cada archivo traza a su requisito (R#).`,
    `6. ${skillsLine} Respeta "una cosa por archivo" (interfaces / DTOs / types cada uno en su archivo).`,
    `7. Herramientas/tests: usa el framework de pruebas que el proyecto YA tiene; no inventes configuración. Si falta tooling, el registro es privado o algo no compila, repórtalo como blocker y pregúntame — no improvises ni cambies de herramienta por tu cuenta.`,
    `8. Si un requisito está marcado [NEEDS CLARIFICATION], pregúntame antes de implementarlo.`,
    `La spec es la fuente de verdad: si cambia el alcance, actualiza la spec primero.`
  ].join('\n');
}

// Hand-off ÚNICO para el orquestador full-stack: un solo mensaje que coordina los dos repos alrededor del
// contrato. No son dos mensajes por repo: es la instrucción del orquestador. Sigue el idioma del spec.
function featureHandoff({ backPath, backRel, frontPath, frontRel, branch, backBranchCreated, frontBranchCreated, specLang }) {
  const code = String(specLang).toLowerCase();
  const en = !(/espa|spanish|castell/.test(code) || code === 'es' || (!specLang && lang === 'es'));
  const both = backBranchCreated && frontBranchCreated;
  const none = !backBranchCreated && !frontBranchCreated;
  const branchNote = en
    ? (both ? `chalc already created it in both` : none ? `create it in each repo: git checkout -b ${branch}` : `chalc created it where the tree was clean; create it where missing: git checkout -b ${branch}`)
    : (both ? `chalc ya la creó en ambos` : none ? `créala en cada repo: git checkout -b ${branch}` : `chalc la creó donde el árbol estaba limpio; donde falte, créala: git checkout -b ${branch}`);
  if (en) {
    return [
      `You are the ORCHESTRATOR of this full-stack feature. You coordinate TWO repos around a single API contract, with Spec-Driven Development and strict TDD.`,
      ``,
      `📜 Contract (source of truth, identical in both specs): \`contracts/api.md\`. Every endpoint, request/response and error comes from there — invent nothing outside it.`,
      ``,
      `Repos:`,
      `- BACKEND (exposes the API):  \`${backPath}\`  → spec: \`${backRel}/\``,
      `- FRONTEND (consumes the API): \`${frontPath}\`  → spec: \`${frontRel}/\``,
      ``,
      `How to orchestrate:`,
      `1. Start with the BACKEND (it owns the contract). Read \`${backRel}/contracts/api.md\`, \`specs/constitution.md\` and \`${backRel}/spec.md\` (R1, R2… in EARS). Follow \`${backRel}/plan.md\` and execute \`${backRel}/tasks.md\` ONE task at a time. Implement EXACTLY the contract's endpoints.`,
      `2. Then the FRONTEND. Same with \`${frontRel}/\`, but CONSUMING the contract (same routes/shapes); don't reimplement backend logic.`,
      `3. R# are SHARED: the same R# is satisfied on backend and/or frontend — keep cross-repo traceability.`,
      `4. Per task, strict TDD: failing test (Red) → minimum code (Green) → refactor. Never code without a failing test first.`,
      `5. Before each task, state which R# and which repo; when done, stop and wait for my OK.`,
      `6. Branch \`${branch}\` in each repo (${branchNote}).`,
      `7. If something is [NEEDS CLARIFICATION] in the contract or a spec, ask me first. The spec is the source of truth: if scope changes, update spec and contract first.`
    ].join('\n');
  }
  return [
    `Eres el ORQUESTADOR de esta feature full-stack. Coordinas DOS repos alrededor de un único contrato de API, con Spec-Driven Development y TDD estricto.`,
    ``,
    `📜 Contrato (fuente de verdad, idéntico en ambas specs): \`contracts/api.md\`. Todo endpoint, request/response y error sale de ahí — no inventes nada fuera del contrato.`,
    ``,
    `Repos:`,
    `- BACKEND (expone la API):  \`${backPath}\`  → spec: \`${backRel}/\``,
    `- FRONTEND (consume la API): \`${frontPath}\`  → spec: \`${frontRel}/\``,
    ``,
    `Cómo orquestar:`,
    `1. Empieza por el BACKEND (es dueño del contrato). Lee \`${backRel}/contracts/api.md\`, \`specs/constitution.md\` y \`${backRel}/spec.md\` (R1, R2… en EARS). Sigue \`${backRel}/plan.md\` y ejecuta \`${backRel}/tasks.md\` UNA tarea a la vez. Implementa EXACTAMENTE los endpoints del contrato.`,
    `2. Sigue con el FRONTEND. Igual con \`${frontRel}/\`, pero CONSUMIENDO el contrato (mismas rutas/shapes); no reimplementes la lógica del back.`,
    `3. Los R# son COMPARTIDOS: el mismo R# se cumple en back y/o front — mantén la trazabilidad cruzada.`,
    `4. Por tarea, TDD estricto: test que falla (Red) → mínimo código (Green) → refactor. Nunca código sin un test que falle primero.`,
    `5. Antes de cada tarea di qué R# y en qué repo; al terminar, párate y espera mi OK.`,
    `6. Rama \`${branch}\` en cada repo (${branchNote}).`,
    `7. Si algo está [NEEDS CLARIFICATION] en el contrato o una spec, pregúntame antes. La spec es la fuente de verdad: si cambia el alcance, actualiza spec y contrato primero.`
  ].join('\n');
}

// Spinner para operaciones largas (llamada a la IA): muestra que SÍ está trabajando.
function startSpinner(msg) {
  if (!stdout.isTTY) { console.log(c.dim('  ' + msg)); return null; }
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  const id = setInterval(() => stdout.write(`\r  ${c.cyan(frames[i++ % frames.length])} ${c.dim(msg)}`), 80);
  return id;
}
function stopSpinner(id) {
  if (id) { clearInterval(id); stdout.write('\r\x1b[2K'); }
}

// Pregunta una ruta OBLIGATORIA: re-pregunta si la dejas vacía o si no existe. No deja pasar nada. (Ctrl+C cancela.)
async function askExistingPath(prompter, question) {
  while (true) {
    const ans = (await prompter.text(question + ':')).trim();
    if (!ans) { console.log(c.yellow('  ! ' + t('pathRequired'))); continue; }
    const p = resolve(cleanPath(ans));
    if (!existsSync(p)) { console.log(c.yellow('  ! ' + t('pathMissing', p))); continue; }
    return p;
  }
}

// Obtiene el texto de la HU/documento desde la fuente elegida (interactivo o por flags). Reusado por spec-ia y feature.
async function acquireUserStory(prompter) {
  if (prompter) {
    const sources = [
      { v: 'file', label: t('srcFile') }, { v: 'azure', label: t('srcAzure') },
      { v: 'jira', label: t('srcJira') }, { v: 'url', label: t('srcUrl') }, { v: 'paste', label: t('srcPaste') }
    ];
    const src = sources[await prompter.select(t('sourceQ'), sources.map((s) => ({ label: s.label })), 0)].v;
    if (src === 'file') return readDocument(resolve(cleanPath(await prompter.text(t('docQ') + ':'))));
    if (src === 'paste') { console.log(c.dim('  ' + t('pasteQ'))); return readPasted(); }
    if (src === 'azure') {
      const url = await prompter.text(t('azureUrlQ') + ':'); const pat = await prompter.secret(t('patQ') + ':');
      console.log(c.dim('  ' + t('fetching'))); return fetchAzureDevOps({ url, pat });
    }
    if (src === 'jira') {
      const url = await prompter.text(t('jiraUrlQ') + ':'); const email = await prompter.text(t('emailQ') + ':'); const token = await prompter.secret(t('tokenQ') + ':');
      console.log(c.dim('  ' + t('fetching'))); return fetchJira({ url, email, token });
    }
    const url = await prompter.text(t('urlQ') + ':'); console.log(c.dim('  ' + t('fetching'))); return fetchUrl(url);
  }
  if (flags.doc) return readDocument(resolve(cleanPath(String(flags.doc))));
  if (flags.azure) return fetchAzureDevOps({ url: String(flags.azure), pat: String(flags.pat || process.env.CHALC_PAT || '') });
  if (flags.jira) return fetchJira({ url: String(flags.jira), email: String(flags.email || ''), token: String(flags.token || process.env.CHALC_TOKEN || '') });
  if (flags.url) return fetchUrl(String(flags.url));
  return '';
}

async function runSpecGen() {
  console.log('\n' + c.bold('⚙️  chalc spec-ia') + (dryRun ? c.dim('  (dry-run)') : '') + '\n');
  const prompter = interactive ? makePrompter() : null;
  // Resolvemos la IA PRIMERO y mostramos proveedor/modelo, antes de cualquier pregunta (que el usuario sepa qué usa).
  let cfg = await resolveAiTaskConfig('spec');
  if (!dryRun && !isConfigured(cfg)) {
    if (!prompter) { console.error(c.red('✗ ' + t('aiNotConfigured'))); process.exit(1); }
    cfg = configForTask(await configureAi(prompter), 'spec');   // primera vez: configura la IA aquí mismo
  }
  printAiLine(cfg);   // muestra qué proveedor/modelo se usará
  // Si la HU tiene backend, esto es full-stack: delega al orquestador (contrato + spec back + spec front).
  if (prompter && !dryRun && !flags.back && await prompter.yesno(t('featHasBackQ'), false)) {
    prompter.close();
    return runFeature({ assumeBack: true });
  }

  let proj = positional[1] ? resolve(cleanPath(positional[1])) : (prompter ? await askExistingPath(prompter, t('pathQ')) : process.cwd());
  if (!existsSync(proj)) { if (prompter) prompter.close(); console.error(c.red('✗ ' + t('pathMissing', proj))); process.exit(1); }

  // .chalc.json es OPCIONAL: un proyecto puede no estar equipado. 
  const chalcJsonPath = join(proj, '.chalc.json');
  let chalcJson = {};
  if (existsSync(chalcJsonPath)) { try { chalcJson = JSON.parse(await readFile(chalcJsonPath, 'utf8')); } catch { /* .chalc.json corrupto: se ignora */ } }
  const sddEntry = (chalcJson.methods || []).find((m) => m === 'sdd' || String(m).startsWith('sdd:'));
  const mode = sddEntry && String(sddEntry).includes(':') ? String(sddEntry).split(':')[1] : 'lite';

  // Idioma del SPEC (el del proyecto), independiente del idioma del CLI. Por flag o preguntando.
  // Se decide ANTES de equipar, para montar la constitución/plantillas/reglas en ese idioma.
  let specLang = flags.lang ? langName(String(flags.lang)) : null;
  if (prompter && !specLang) {
    const optsL = [{ label: 'Español', value: 'español' }, { label: 'English', value: 'English' }, { label: t('otherLang'), value: '__other' }];
    const idx = await prompter.select(t('specLangQ'), optsL.map((o) => ({ label: o.label })), lang === 'en' ? 1 : 0);
    specLang = optsL[idx].value;
    if (specLang === '__other') specLang = (await prompter.text(t('otherLangQ') + ':')).trim() || langName(lang);
  }
  if (!specLang) specLang = langName(lang);

  const hadSdd = existsSync(join(proj, 'specs', 'constitution.md'));
  const specTarget = chalcJson.target || (flags.target ? String(flags.target) : 'claude');
  let equippedSkills = [];
  if (!dryRun) {
    equippedSkills = await equipForSpec(proj, mode, specTarget, specLang);   // equipa skills + SDD en el idioma del spec
    if (!hadSdd) console.log(c.dim('  ' + t('sddScaffolded')));
  }
  const specsDir = join(proj, 'specs');

  // Plantillas/constitución: del proyecto si existen; si no (ej. dry-run en proyecto crudo), del catálogo (idioma del spec).
  const base = mode === 'full' ? 'scaffold-full' : 'scaffold-lite';
  const scName = (langCode(specLang) === 'en' && existsSync(join(METHODS_DIR, 'sdd', `${base}-en`))) ? `${base}-en` : base;
  const catSpecs = join(METHODS_DIR, 'sdd', scName, 'specs');
  const tplDir = join(specsDir, '_template');
  const readIf = async (p, fb) => (existsSync(p) ? readFile(p, 'utf8') : (fb && existsSync(fb) ? readFile(fb, 'utf8') : ''));
  const templates = {
    spec: await readIf(join(tplDir, 'spec.md'), join(catSpecs, '_template', 'spec.md')),
    plan: await readIf(join(tplDir, 'plan.md'), join(catSpecs, '_template', 'plan.md')),
    tasks: await readIf(join(tplDir, 'tasks.md'), join(catSpecs, '_template', 'tasks.md'))
  };
  const constitution = await readIf(join(specsDir, 'constitution.md'), join(catSpecs, 'constitution.md'));

  const documentText = await acquireUserStory(prompter);
  if (!documentText.trim()) { if (prompter) prompter.close(); console.error(c.red('✗ ' + t('docEmpty'))); process.exit(1); }

  const feature = flags.feature ? String(flags.feature) : '';   // la IA lo infiere; no se pregunta

  const opts = { language: specLang, mode, documentText, templates, constitution };

  if (dryRun) {
    const { system, user } = await buildPrompt(opts);
    if (prompter) prompter.close();
    console.log(c.bold('\n--- SYSTEM PROMPT ---\n') + system);
    console.log(c.bold('\n--- USER ---\n') + user.slice(0, 1200) + (user.length > 1200 ? '\n' + t('specgenTruncated') : ''));
    console.log('\n' + c.dim(t('specgenDryRunNote') + '\n'));
    return;
  }

  if (prompter) prompter.close();
  console.log('');
  const spin = startSpinner(t('generating', cfg.model || PROVIDERS[cfg.provider].defaultModel));
  let result;
  try { result = await generateSpec(cfg, opts); }
  finally { stopSpinner(spin); }
  const validation = summarizeValidation(result.validation || []);
  if (result.validation?.length) {
    console.log(c.yellow('\n! ' + t('specgenValidation', validation.errors, validation.warnings)));
    for (const issue of result.validation.slice(0, 8)) {
      const mark = issue.level === 'error' ? c.red('✗') : c.yellow('!');
      console.log(`  ${mark} ${issue.message}`);
    }
    if (validation.errors) throw new Error(t('specgenValidationFailed'));
  }

  const feat = (feature || result.feature || 'feature').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'feature';
  // Idempotente: re-generar la misma feature actualiza su carpeta en sitio, no crea un NNN+1 duplicado.
  const folder = await resolveFeatureFolder(specsDir, feat);
  if (folder.reused) console.log('  ' + c.yellow('!') + ' ' + t('specReusingFolder', folder.name));
  const rel = join('specs', folder.name);
  const dest = join(proj, rel);
  await mkdir(dest, { recursive: true });
  // En full, la feature debe traer también data-model/research/quickstart/contracts: copio las
  // plantillas del modo y luego sobreescribo las 3 que la IA generó (spec/plan/tasks).
  const tplSrc = join(specsDir, '_template');
  if (existsSync(tplSrc)) await cp(tplSrc, dest, { recursive: true, force: false, errorOnExist: false, dereference: true });
  for (const [name, content] of Object.entries(result.files)) {
    await writeFile(join(dest, name), String(content).replace(/\s*$/, '') + '\n');
  }
  await appendAiTrace(proj, folder.name, makeAiTrace({
    task: 'spec',
    provider: cfg.provider,
    model: cfg.model,
    system: result.trace?.system,
    user: result.trace?.user,
    output: result.trace?.raw,
    extra: { validation }
  }));
  console.log('\n' + c.green('✓ ' + t('specWritten', rel)));
  console.log('\n' + c.bold(t('handoff')) + '\n');
  console.log(c.cyan(handoffCommand(rel, equippedSkills, specLang)) + '\n');
}

// Carga plantillas + constitución de un proyecto (del repo si existen; si no, del catálogo en el idioma del spec).
async function loadSpecScaffold(proj, mode, specLang) {
  const specsDir = join(proj, 'specs');
  const base = mode === 'full' ? 'scaffold-full' : 'scaffold-lite';
  const scName = (langCode(specLang) === 'en' && existsSync(join(METHODS_DIR, 'sdd', `${base}-en`))) ? `${base}-en` : base;
  const catSpecs = join(METHODS_DIR, 'sdd', scName, 'specs');
  const tplDir = join(specsDir, '_template');
  const readIf = async (p, fb) => (existsSync(p) ? readFile(p, 'utf8') : (fb && existsSync(fb) ? readFile(fb, 'utf8') : ''));
  const templates = {
    spec: await readIf(join(tplDir, 'spec.md'), join(catSpecs, '_template', 'spec.md')),
    plan: await readIf(join(tplDir, 'plan.md'), join(catSpecs, '_template', 'plan.md')),
    tasks: await readIf(join(tplDir, 'tasks.md'), join(catSpecs, '_template', 'tasks.md'))
  };
  const constitution = await readIf(join(specsDir, 'constitution.md'), join(catSpecs, 'constitution.md'));
  return { templates, constitution, specsDir };
}

// Etiqueta del stack de un repo (las reglas que aplican, sin la global). '' si no reconoce nada.
async function detectStackLabel(dir) {
  const matched = matchRules(await loadJsonDir(RULES_DIR), await detectContext(dir)).filter((r) => !r.always);
  return matched.map((r) => r.name).join(' + ');
}

// Escribe la spec de un lado en specs/NNN-slug/. En full, copia primero las plantillas del modo
// (data-model/research/contracts/quickstart) y luego sobreescribe spec/plan/tasks con lo que generó la IA.
async function writeSideSpec(proj, slug, files, preferredNum = null) {
  // Idempotente: si ya existe carpeta para este slug se REÚSA (no se crea NNN+1 duplicado);
  // si es nueva, usa el número compartido entre repos (preferredNum) para alinear front/back.
  const folder = await resolveFeatureFolder(join(proj, 'specs'), slug, preferredNum);
  const rel = join('specs', folder.name);
  const dest = join(proj, rel);
  await mkdir(dest, { recursive: true });
  const tplSrc = join(proj, 'specs', '_template');
  if (existsSync(tplSrc)) await cp(tplSrc, dest, { recursive: true, force: false, errorOnExist: false, dereference: true });
  for (const [name, content] of Object.entries(files)) await writeFile(join(dest, name), String(content).replace(/\s*$/, '') + '\n');
  return { rel, dest, id: folder.name, reused: folder.reused };
}

// ---------- comando: chalc feature (orquestador full-stack: HU → contrato + spec back + spec front) ----------
async function runFeature(opts = {}) {
  console.log('\n' + c.bold('⚙️  ' + t('featHdr')) + (dryRun ? c.dim('  (dry-run)') : '') + '\n');
  const prompter = interactive ? makePrompter() : null;
  let cfg = await resolveAiTaskConfig('spec');
  if (!isConfigured(cfg)) {
    if (!prompter) { console.error(c.red('✗ ' + t('aiNotConfigured'))); process.exit(1); }
    cfg = configForTask(await configureAi(prompter), 'spec');
  }
  printAiLine(cfg);   // muestra qué proveedor/modelo se usará

  // 1) Rutas: front y back. Obligatorias: si las dejas vacías o inexistentes, re-pregunta (no deja pasar).
  let frontPath = positional[1] ? resolve(cleanPath(positional[1])) : (prompter ? await askExistingPath(prompter, t('featFrontQ')) : process.cwd());
  let backPath = flags.back ? resolve(cleanPath(String(flags.back))) : '';
  if (!backPath && prompter && (opts.assumeBack || await prompter.yesno(t('featHasBackQ'), true))) {
    backPath = await askExistingPath(prompter, t('featBackPathQ'));
  }
  if (!backPath) { if (prompter) prompter.close(); console.error(c.yellow('! ' + t('featNoBack'))); process.exit(1); }
  for (const p of [frontPath, backPath]) {
    if (!existsSync(p)) { if (prompter) prompter.close(); console.error(c.red('✗ ' + t('pathMissing', p))); process.exit(1); }
  }
  // Identifica los stacks YA, para que el usuario confirme que reconoció bien cada repo antes de seguir.
  const frontStack = await detectStackLabel(frontPath);
  const backStack = await detectStackLabel(backPath);
  console.log('  ' + c.green('✓') + ' ' + t('featDetect', frontStack || c.yellow(t('featUnknownStack')), backStack || c.yellow(t('featUnknownStack'))));
  if (!frontStack || !backStack) console.log(c.dim('  ' + t('featUnknownHint')));
  // Se decide ahora; se crea al final (el nombre sale del slug). --no-branch evita la pregunta.
  const wantBranch = flags.branch ?? (prompter ? await prompter.yesno(t('featBranchQ'), false) : false);

  // 2) Idioma del spec + modo (del back si está equipado).
  let specLang = flags.lang ? langName(String(flags.lang)) : null;
  if (prompter && !specLang) {
    const optsL = [{ label: 'Español', value: 'español' }, { label: 'English', value: 'English' }, { label: t('otherLang'), value: '__other' }];
    const idx = await prompter.select(t('specLangQ'), optsL.map((o) => ({ label: o.label })), lang === 'en' ? 1 : 0);
    specLang = optsL[idx].value;
    if (specLang === '__other') specLang = (await prompter.text(t('otherLangQ') + ':')).trim() || langName(lang);
  }
  if (!specLang) specLang = langName(lang);
  const readTarget = (p) => { try { return JSON.parse(readFileSync(join(p, '.chalc.json'), 'utf8')).target || 'claude'; } catch { return 'claude'; } };
  const readMode = (p) => { try { const m = (JSON.parse(readFileSync(join(p, '.chalc.json'), 'utf8')).methods || []).find((x) => String(x).startsWith('sdd')); return m && String(m).includes(':') ? String(m).split(':')[1] : 'lite'; } catch { return 'lite'; } };
  // Modo SDD: --full/--mode mandan; si no, lee el modo ACTUAL del back y pregunta si quieres cambiarlo.
  let mode = flags.full ? 'full' : String(flags.mode || '').toLowerCase();
  if (mode !== 'lite' && mode !== 'full') {
    const current = readMode(backPath);                          // lo que ya tiene equipado el back (default lite)
    if (prompter) {
      const other = current === 'full' ? 'lite' : 'full';
      mode = (await prompter.yesno(t('sddModeCurrentQ', current, other), false)) ? other : current;
    } else { mode = current; }
  }

  // 3) HU.
  const userStory = await acquireUserStory(prompter);
  if (!userStory.trim()) { if (prompter) prompter.close(); console.error(c.red('✗ ' + t('docEmpty'))); process.exit(1); }

  // 4) Estado Git PREVIO + readiness. El git va PRIMERO: equipar escribe archivos y ensuciaría el árbol,
  // así que capturamos aquí el estado real (limpio/sucio) para decidir luego si es seguro crear la rama.
  if (prompter) prompter.close();
  console.log('\n' + c.bold('🔎 ' + t('featReadiness')));
  const gitState = {};
  for (const [name, p] of [['front', frontPath], ['back', backPath]]) {
    const pull = await safePull(p);
    gitState[name] = pull;
    const mark = pull.ok ? c.green('✓') : c.yellow('!');
    console.log('  ' + mark + ' ' + t('featGit', name, t('gitReason_' + pull.reason.replace(/-/g, '_'))));
  }
  const skillsFront = await equipForSpec(frontPath, mode, readTarget(frontPath), specLang);
  const skillsBack = await equipForSpec(backPath, mode, readTarget(backPath), specLang);
  console.log('  ' + c.green('✓') + ' ' + t('featReadyRepo', 'front', skillsFront.length));
  console.log('  ' + c.green('✓') + ' ' + t('featReadyRepo', 'back', skillsBack.length));

  // 6) Contexto del back para el contrato (architecture.md si existe). Los stacks ya se detectaron arriba.
  const backContext = existsSync(join(backPath, 'docs', 'architecture.md')) ? await readFile(join(backPath, 'docs', 'architecture.md'), 'utf8') : '';

  // 7) Orquestar: contrato → spec back → spec front.
  const backScaffold = await loadSpecScaffold(backPath, mode, specLang);
  const frontScaffold = await loadSpecScaffold(frontPath, mode, specLang);
  const spin = startSpinner(t('featOrchestrating'));
  let result;
  try {
    result = await orchestrateFeature({
      cfg, userStory, language: specLang, mode, backContext,
      back: { stack: backStack, templates: backScaffold.templates, constitution: backScaffold.constitution },
      front: { stack: frontStack, templates: frontScaffold.templates, constitution: frontScaffold.constitution }
    });
  } finally { stopSpinner(spin); }

  // 8) Escribir: back (spec + contrato) y front (spec + copia del contrato para consumirlo).
  // Un mismo NNN para ambos repos (IDs alineados front/back) en features nuevas; si un repo ya
  // tenía la carpeta del slug, writeSideSpec la reúsa. El contrato se estampa en cada spec y se
  // guarda un lock: así spec/plan/tasks NUNCA quedan desincronizados del contrato que los originó.
  const slug = (result.front.feature || result.back.feature || 'feature').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'feature';
  const fp = contractFingerprint(result.contract);
  const generatedAt = new Date().toISOString();
  const stamp = contractStamp(fp, generatedAt);
  const sharedNum = await sharedNumber([join(frontPath, 'specs'), join(backPath, 'specs')]);
  const backOut = await writeSideSpec(backPath, slug, stampFiles(result.back.files, stamp), sharedNum);
  const frontOut = await writeSideSpec(frontPath, slug, stampFiles(result.front.files, stamp), sharedNum);
  for (const [role, out] of [['back', backOut], ['front', frontOut]]) {
    if (out.reused) console.log('  ' + c.yellow('!') + ' ' + t('featReusingFolder', role, out.id));
    const prev = await readContractLock(out.dest);
    if (prev && prev.contractHash !== fp) console.log('  ' + c.yellow('!') + ' ' + t('featContractRefreshed', role));
    await mkdir(join(out.dest, 'contracts'), { recursive: true });
    await writeFile(join(out.dest, 'contracts', 'api.md'), result.contract.replace(/\s*$/, '') + '\n');
    await writeContractLock(out.dest, { slug, contractHash: fp, generatedAt, role });
  }
  await appendAiTrace(backPath, backOut.id, makeAiTrace({ task: 'feature-back', provider: cfg.provider, model: cfg.model, system: result.back.trace?.system, user: result.back.trace?.user, output: result.back.trace?.raw }));
  await appendAiTrace(frontPath, frontOut.id, makeAiTrace({ task: 'feature-front', provider: cfg.provider, model: cfg.model, system: result.front.trace?.system, user: result.front.trace?.user, output: result.front.trace?.raw }));

  console.log('\n' + c.green('✓ ' + t('featSpecWritten', 'back', join(backOut.rel))));
  console.log(c.green('✓ ' + t('featSpecWritten', 'front', join(frontOut.rel))));
  console.log(c.dim('  ' + t('featContractAt', 'contracts/api.md')));

  // 9) Rama de feature (opt-in), nombrada por el slug. SOLO se crea si el repo estaba limpio antes
  // (si tenía cambios sin commitear, no la creo para no arrastrar tu trabajo pendiente). Los specs nuevos viajan con ella.
  const branchName = `feat/${slug}`;
  const branchCreated = { front: false, back: false };
  if (wantBranch) {
    // TODO O NADA: la feature debe quedar en la MISMA rama en ambos repos. Si alguno está sucio, no creo ninguna.
    const dirty = [['front', frontPath], ['back', backPath]].filter(([name]) => gitState[name]?.reason === 'dirty').map(([name]) => name);
    if (dirty.length) {
      console.log('  ' + c.yellow('!') + ' ' + t('featBranchSkipDirty', dirty.join(' / ')));
    } else {
      for (const [name, p] of [['front', frontPath], ['back', backPath]]) {
        const b = await createFeatureBranch(p, branchName);
        branchCreated[name] = b.ok;
        console.log('  ' + (b.ok ? c.green('✓') : c.yellow('!')) + ' ' + t('featBranch', name, b.branch, t('gitBranch_' + b.reason.replace(/-/g, '_'))));
      }
    }
  } else {
    console.log(c.dim('\n  ' + t('featBranchHint', branchName)));
  }

  console.log('\n' + c.green('✓ ' + t('featDone')));

  // Hand-off ÚNICO del orquestador: un solo mensaje que coordina ambos repos alrededor del contrato.
  console.log('\n' + c.bold(t('handoff')) + '\n');
  console.log(c.cyan(featureHandoff({
    backPath, backRel: backOut.rel, frontPath, frontRel: frontOut.rel, branch: branchName,
    backBranchCreated: branchCreated.back, frontBranchCreated: branchCreated.front, specLang
  })) + '\n');
}

// Muestra el consumo de tokens SIEMPRE que se haya consultado la IA en este comando (transparencia de gasto).
function printTokenUsage() {
  const s = tokenSummary();
  if (s.calls > 0) console.log('\n' + c.dim(t('tokensUsed', s.total, s.input, s.output, s.calls)));
}

(verb === 'lang' ? runConfigLang() : verb === 'init' ? runInit() : verb === 'verify' ? runVerify() : verb === 'install' ? runInstall() : verb === 'inspect' ? runInspect() : verb === 'doctor' ? runDoctor() : verb === 'configure' ? runConfigure() : verb === 'ai' ? runAi() : verb === 'aidoctor' ? runAiDoctor() : verb === 'aieval' ? runAiEval() : verb === 'specgen' ? runSpecGen() : verb === 'feature' ? runFeature() : verb === 'spec' ? runSpec() : verb === 'qa' ? runQa() : runApply())
  .then(() => printTokenUsage())
  .catch((err) => {
    printTokenUsage();
    const message = err instanceof Error ? err.message : String(err?.message ?? err);
    console.error(c.red('✗ ' + message));
    process.exit(1);
  });
