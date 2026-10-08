// Chequeos de `chalc doctor`, uno por área del catálogo. Cada uno devuelve la lista de hallazgos
// `{ level, area, message, detail }`; el comando decide qué áreas correr y cómo mostrarlas.

import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isSafeId } from '../ids.mjs';
import { PROVIDERS } from '../ai.mjs';
import { skillDir } from '../userstore.mjs';
import { t } from '../i18n.mjs';

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

// Un MCP es local (server.command + args) o remoto (server.url, solo https). Nunca ambos: el target
// copia `server` tal cual y el asistente no sabría cuál de los dos transportes usar.
export function mcpServerIssues(name, server) {
  const issues = [];
  if (server?.url !== undefined) {
    if (server.command !== undefined) issues.push(makeIssue('error', 'mcp', t('drMcpBoth', name)));
    if (typeof server.url !== 'string' || !/^https:\/\/[^\s]+$/.test(server.url)) issues.push(makeIssue('error', 'mcp', t('drMcpHttps', name)));
    return issues;
  }
  if (!server?.command) return [makeIssue('error', 'mcp', t('drMcpNone', name))];
  if (hasShellSyntax(server.command)) issues.push(makeIssue('error', 'mcp', t('drMcpShellCmd', name)));
  if (server.args && !Array.isArray(server.args)) issues.push(makeIssue('error', 'mcp', t('drMustBeArray', `${name}.server.args`)));
  if (Array.isArray(server.args)) {
    for (const arg of server.args) {
      if (typeof arg !== 'string') issues.push(makeIssue('error', 'mcp', t('drMustHoldStrings', `${name}.server.args`)));
    }
  }
  return issues;
}

// El id de un archivo JSON del catálogo: que exista, que sea seguro y que coincida con el nombre.
function idIssues(area, file, id) {
  const issues = [];
  if (!id) issues.push(makeIssue('error', area, t('drNoId', file)));
  else if (!isSafeId(id)) issues.push(makeIssue('error', area, t('drUnsafeId', file, id)));
  if (id && file !== `${id}.json`) issues.push(makeIssue('warn', area, t('drIdMismatch', file, id)));
  return issues;
}

const DETECT_KEYS = ['anyDependency', 'anyFile', 'anyGlob', 'allDependency', 'allFile', 'allGlob'];

// La forma de una regla: id, name, detect y que sus listas sean listas.
function ruleShapeIssues(rule, file) {
  const issues = [];
  if (!rule.id) issues.push(makeIssue('error', 'rules', t('drNoId', file)));
  else if (!isSafeId(rule.id)) issues.push(makeIssue('error', 'rules', t('drUnsafeId', file, rule.id)));
  if (rule.id && file !== `${rule.id}.json`) issues.push(makeIssue('warn', 'rules', t('drIdMismatch', file, rule.id)));
  if (!rule.name) issues.push(makeIssue('warn', 'rules', t('drNoName', rule.id || file)));
  if (!rule.always && !rule.detect) issues.push(makeIssue('error', 'rules', t('drNoDetect', rule.id || file)));
  const d = rule.detect || {};
  for (const key of Object.keys(d)) {
    if (!DETECT_KEYS.includes(key)) issues.push(makeIssue('warn', 'rules', t('drUnknownDetect', rule.id, key)));
    else if (!Array.isArray(d[key])) issues.push(makeIssue('error', 'rules', t('drMustBeArray', `${rule.id}.detect.${key}`)));
  }
  for (const key of ['skills', 'mcp', 'optionalMcp']) {
    if (rule[key] && !Array.isArray(rule[key])) issues.push(makeIssue('error', 'rules', t('drMustBeArray', `${rule.id}.${key}`)));
    if (Array.isArray(rule[key])) {
      for (const dupe of duplicates(rule[key])) issues.push(makeIssue('warn', 'rules', t('drDuplicateIn', `${rule.id}.${key}`, dupe)));
    }
  }
  return issues;
}

// Lo que una regla referencia: reglas implicadas, skills y MCP, que existan y tengan id seguro.
function ruleRefIssues(rule, { rules, skillSet, mcpSet }) {
  const issues = [];
  if (Array.isArray(rule.implies)) {
    for (const implied of rule.implies) {
      if (!isSafeId(String(implied))) issues.push(makeIssue('error', 'rules', t('drImpliesUnsafe', rule.id, implied)));
      else if (!rules.some((candidate) => candidate.id === implied)) issues.push(makeIssue('error', 'rules', t('drImpliesMissing', rule.id, implied)));
    }
  } else if (rule.implies) {
    issues.push(makeIssue('error', 'rules', t('drMustBeArray', `${rule.id}.implies`)));
  }
  for (const s of rule.skills || []) {
    if (!isSafeId(String(s))) issues.push(makeIssue('error', 'rules', t('drRefUnsafe', rule.id, 'skill', s)));
    if (!skillSet.has(s)) issues.push(makeIssue('error', 'rules', t('drRefMissing', rule.id, 'skill', s)));
  }
  for (const m of [...(rule.mcp || []), ...(rule.optionalMcp || [])]) {
    if (!isSafeId(String(m))) issues.push(makeIssue('error', 'rules', t('drRefUnsafe', rule.id, 'MCP', m)));
    if (!mcpSet.has(m)) issues.push(makeIssue('error', 'rules', t('drRefMissing', rule.id, 'MCP', m)));
  }
  return issues;
}

export function ruleIssues(ruleFiles, refs) {
  return ruleFiles.flatMap((r) => (r.error
    ? [makeIssue('error', 'rules', t('drBadJson', r.file), r.error.message)]
    : [...ruleShapeIssues(r.json, r.file), ...ruleRefIssues(r.json, refs)]));
}

export async function skillIssues(CATALOG, skillIds) {
  const issues = [];
  for (const id of skillIds) {
    if (!isSafeId(id)) issues.push(makeIssue('error', 'skills', t('drUnsafeOwnId', id)));
    const skillFile = join(skillDir(CATALOG, id), 'SKILL.md');
    if (!existsSync(skillFile)) { issues.push(makeIssue('error', 'skills', t('drNoSkillMd', id))); continue; }
    const text = await readFile(skillFile, 'utf8');
    if (!/^---\r?\n[\s\S]*?\r?\n---/.test(text)) issues.push(makeIssue('warn', 'skills', t('drNoFrontmatter', id)));
    if (!/^name:[^\S\r\n]*\S/m.test(text)) issues.push(makeIssue('warn', 'skills', t('drNoDeclare', id, 'name')));
    if (!/^description:[^\S\r\n]*\S/m.test(text)) issues.push(makeIssue('warn', 'skills', t('drNoDeclare', id, 'description')));
  }
  return issues;
}

function mcpEnvIssues(name, env) {
  if (!env) return [];
  if (typeof env !== 'object' || Array.isArray(env)) return [makeIssue('error', 'mcp', t('drMustBeObject', `${name}.server.env`))];
  const issues = [];
  for (const [key, value] of Object.entries(env)) {
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) issues.push(makeIssue('warn', 'mcp', t('drEnvOddName', name, key)));
    if (typeof value !== 'string') issues.push(makeIssue('error', 'mcp', t('drMustBeString', `${name}.server.env.${key}`)));
  }
  return issues;
}

export function mcpFileIssues(mcpFiles) {
  return mcpFiles.flatMap((m) => {
    if (m.error) return [makeIssue('error', 'mcp', t('drBadJson', m.file), m.error.message)];
    const def = m.json;
    return [...idIssues('mcp', m.file, def.id), ...mcpServerIssues(def.id || m.file, def.server), ...mcpEnvIssues(def.id || m.file, def.server?.env)];
  });
}

export function profileIssues(profileFiles) {
  return profileFiles.flatMap((p) => {
    if (p.error) return [makeIssue('error', 'profiles', t('drBadJson', p.file), p.error.message)];
    const profile = p.json;
    const issues = idIssues('profiles', p.file, profile.id);
    for (const task of ['spec', 'qa', 'repair']) {
      const entry = profile.models?.[task];
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) issues.push(makeIssue('error', 'profiles', t('drProfileModels', `${profile.id || p.file}.models.${task}`)));
      else {
        for (const provider of Object.keys(entry)) if (!PROVIDERS[provider]) issues.push(makeIssue('warn', 'profiles', t('drUnknownProvider', `${profile.id}.models.${task}`, provider)));
      }
    }
    return issues;
  });
}

// Cada modo de un método: id seguro y que su scaffold y sus reglas (por idioma) existan.
function methodModeIssues(dir, name, mode) {
  const issues = [];
  const label = `${name}:${mode.id || '?'}`;
  if (!mode.id) issues.push(makeIssue('error', 'methods', t('drModeNoId', name)));
  else if (!isSafeId(mode.id)) issues.push(makeIssue('error', 'methods', t('drModeUnsafe', name, mode.id)));
  for (const [key, files] of [['scaffold', localizedFiles(mode.scaffold)], ['rules', localizedFiles(mode.rules)]]) {
    if (!files.length) issues.push(makeIssue('error', 'methods', t('drLocalized', label, key)));
    for (const file of files) {
      if (!existsSync(join(dir, file))) issues.push(makeIssue('error', 'methods', t('drMissingPart', label, key), file));
    }
  }
  return issues;
}

async function methodIssuesOf(methodsDir, dirName) {
  const dir = join(methodsDir, dirName);
  const file = join(dir, 'method.json');
  if (!existsSync(file)) return [makeIssue('error', 'methods', t('drNoMethodJson', dirName))];
  let meta;
  try { meta = JSON.parse(await readFile(file, 'utf8')); } catch (e) {
    return [makeIssue('error', 'methods', t('drMethodInvalid', dirName), e.message)];
  }
  const issues = [];
  if (!meta.id) issues.push(makeIssue('error', 'methods', t('drNoId', `${dirName}/method.json`)));
  else if (!isSafeId(meta.id)) issues.push(makeIssue('error', 'methods', t('drUnsafeId', `${dirName}/method.json`, meta.id)));
  else if (meta.id !== dirName) issues.push(makeIssue('warn', 'methods', t('drMethodDirMismatch', dirName, meta.id)));
  const modes = meta.modes || [{ id: 'default', scaffold: meta.scaffold, rules: meta.rules }];
  for (const mode of modes) issues.push(...methodModeIssues(dir, meta.id || dirName, mode));
  return issues;
}

export async function methodIssues(methodsDir) {
  if (!existsSync(methodsDir)) return [];
  const dirs = (await readdir(methodsDir, { withFileTypes: true })).filter((d) => d.isDirectory());
  const issues = [];
  for (const d of dirs) issues.push(...await methodIssuesOf(methodsDir, d.name));
  return issues;
}

// Los JSON del catálogo que se cargan omitiendo los ilegibles (contratos de roles, tabla de
// herramientas): al equipar solo se avisa, aquí es un error con su archivo.
export async function catalogJsonIssues(area, files) {
  const issues = [];
  for (const file of files) {
    try { JSON.parse(await readFile(file, 'utf8')); } catch (e) { issues.push(makeIssue('error', area, t('drJsonInvalid', file), e.message)); }
  }
  return issues;
}

export async function targetIssues(targetsDir) {
  const targets = existsSync(targetsDir) ? (await readdir(targetsDir)).filter((f) => f.endsWith('.mjs')) : [];
  const issues = [];
  for (const file of targets) {
    const id = file.replace(/\.mjs$/, '');
    if (!isSafeId(id)) issues.push(makeIssue('error', 'targets', t('drUnsafeOwnId', file)));
    try {
      const mod = await import(pathToFileURL(join(targetsDir, file)).href);
      if (!mod.label) issues.push(makeIssue('warn', 'targets', t('drNoExport', file, 'label')));
      if (typeof mod.apply !== 'function') issues.push(makeIssue('error', 'targets', t('drNoExport', file, 'apply()')));
    } catch (e) {
      issues.push(makeIssue('error', 'targets', t('drTargetLoad', file), e.message));
    }
  }
  if (!targets.length) issues.push(makeIssue('error', 'targets', t('drNoTargets')));
  return issues;
}
