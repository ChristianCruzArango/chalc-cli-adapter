// Acceso al catálogo de chalc (reglas, MCP, métodos, targets) y utilidades de datos compartidas.

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { t, lang } from '../i18n.mjs';
import { assertSafeId } from '../ids.mjs';
import { CATALOG, METHODS_DIR, RULES_DIR, TARGETS_DIR, cleanPath } from './context.mjs';

export function deepSub(obj, vars) {
  if (typeof obj === 'string') return obj.replace(/\$\{(\w+)\}/g, (_, k) => vars[k] ?? `\${${k}}`);
  if (Array.isArray(obj)) return obj.map((v) => deepSub(v, vars));
  if (obj && typeof obj === 'object') {
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, deepSub(v, vars)]));
  }
  return obj;
}

export async function loadJsonDir(dir) {
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  return Promise.all(files.map(async (f) => JSON.parse(await readFile(join(dir, f), 'utf8'))));
}

export async function loadMcp(id) {
  id = assertSafeId(id, 'MCP id');
  const file = join(CATALOG, 'mcp', `${id}.json`);
  if (!existsSync(file)) throw new Error(t('mcpNotInCatalog', id));
  const def = JSON.parse(await readFile(file, 'utf8'));
  def.id = assertSafeId(def.id || id, 'MCP id');
  return def;
}

// Elige el valor en el idioma dado (default = idioma del CLI); acepta string (legado) u objeto {es,en,...}.
export function pick(val, l = lang) {
  if (val && typeof val === 'object' && !Array.isArray(val)) return val[l] ?? val.en ?? Object.values(val)[0];
  return val;
}

// Normaliza un nombre/código de idioma a 'es'/'en' (para elegir archivos del método). Otros → idioma del CLI.
export function langCode(v) {
  const s = String(v || '').toLowerCase();
  if (/espa|spanish|castell/.test(s) || s === 'es') return 'es';
  if (/engl|ingl/.test(s) || s === 'en') return 'en';
  return lang;
}

export async function loadMethods(l = lang) {
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

export async function loadTargets() {
  if (!existsSync(TARGETS_DIR)) return [];
  const files = (await readdir(TARGETS_DIR)).filter((f) => f.endsWith('.mjs'));
  return Promise.all(files.map(async (file) => {
    const id = file.replace(/\.mjs$/, '');
    const mod = await import(pathToFileURL(join(TARGETS_DIR, file)).href);
    return { id, label: mod.label || id };
  }));
}

export function formatList(items, empty = '—') {
  return items.length ? items.join(', ') : empty;
}

export function slugifyFeatureName(name) {
  return cleanPath(name)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'feature';
}

export function slugifyId(name) {
  return cleanPath(name)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function writeJson(file, obj) {
  await writeFile(file, JSON.stringify(obj, null, 2) + '\n');
}

export async function loadRules() {
  return (await loadJsonDir(RULES_DIR)).sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

export async function loadJsonFiles(dir) {
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
