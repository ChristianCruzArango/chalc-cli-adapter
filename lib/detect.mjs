import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// La detección se ANCLA A LA RAÍZ: el stack se define por las dependencias del
// package.json raíz y por archivos/globs en la raíz. Escanear en profundidad
// daba falsos positivos (catálogos, ejemplos o scripts anidados disparaban stacks).
export async function detectContext(dir) {
  let deps = {};
  const pkg = join(dir, 'package.json');
  if (existsSync(pkg)) {
    try {
      const json = JSON.parse(await readFile(pkg, 'utf8'));
      deps = { ...(json.dependencies || {}), ...(json.devDependencies || {}) };
    } catch { /* package.json inválido: se ignora */ }
  }
  const entries = existsSync(dir) ? await readdir(dir) : [];
  const globMatches = (pattern) => {
    const re = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
    return entries.filter((f) => re.test(f));
  };
  return {
    deps,
    entries,
    files: entries,
    hasFile: (name) => entries.includes(name),
    glob: (pattern) => globMatches(pattern).length > 0,
    globMatches
  };
}

export function ruleReasons(rule, ctx) {
  if (rule.always) return ['regla global'];
  const d = rule.detect || {};
  const reasons = [];
  const missingAll = [];
  for (const dep of d.allDependency || []) {
    if (ctx.deps[dep]) reasons.push(`dependency ${dep}`);
    else missingAll.push(`dependency ${dep}`);
  }
  for (const file of d.allFile || []) {
    if (ctx.hasFile(file)) reasons.push(`file ${file}`);
    else missingAll.push(`file ${file}`);
  }
  for (const pattern of d.allGlob || []) {
    const matches = ctx.globMatches(pattern);
    if (matches.length) reasons.push(`glob ${pattern}: ${matches.join(', ')}`);
    else missingAll.push(`glob ${pattern}`);
  }
  if (missingAll.length) return [];
  const anyReasons = [];
  for (const dep of d.anyDependency || []) {
    if (ctx.deps[dep]) anyReasons.push(`dependency ${dep}`);
  }
  for (const file of d.anyFile || []) {
    if (ctx.hasFile(file)) anyReasons.push(`file ${file}`);
  }
  for (const pattern of d.anyGlob || []) {
    const matches = ctx.globMatches(pattern);
    if (matches.length) anyReasons.push(`glob ${pattern}: ${matches.join(', ')}`);
  }
  const hasAnyConfig = !!(d.anyDependency?.length || d.anyFile?.length || d.anyGlob?.length);
  if (hasAnyConfig && !anyReasons.length) return [];
  return reasons.concat(anyReasons);
}

export function ruleMatches(rule, ctx) {
  if (rule.always) return true;
  const d = rule.detect || {};
  if (d.allDependency?.some((x) => !ctx.deps[x])) return false;
  if (d.allFile?.some((f) => !ctx.hasFile(f))) return false;
  if (d.allGlob?.some((g) => !ctx.glob(g))) return false;
  const hasAllConfig = !!(d.allDependency?.length || d.allFile?.length || d.allGlob?.length);
  const hasAnyConfig = !!(d.anyDependency?.length || d.anyFile?.length || d.anyGlob?.length);
  const anyMatches = !!(
    d.anyDependency?.some((x) => ctx.deps[x])
    || d.anyFile?.some((f) => ctx.hasFile(f))
    || d.anyGlob?.some((g) => ctx.glob(g))
  );
  if (hasAllConfig && !hasAnyConfig) return true;
  if (hasAllConfig && hasAnyConfig) return anyMatches;
  return anyMatches;
}

// Reglas que aplican, suprimiendo los lenguajes genéricos que un stack específico
// ya implica (ej. Angular implica javascript/typescript).
export function matchRules(rules, ctx) {
  const all = rules.filter((r) => ruleMatches(r, ctx));
  const implied = new Set(all.flatMap((r) => r.implies || []));
  return all.filter((r) => !implied.has(r.id));
}

export function formatDetect(rule) {
  const d = rule.detect || {};
  const parts = [];
  if (d.allDependency?.length) parts.push(`all deps: ${d.allDependency.join(', ')}`);
  if (d.allFile?.length) parts.push(`all files: ${d.allFile.join(', ')}`);
  if (d.allGlob?.length) parts.push(`all globs: ${d.allGlob.join(', ')}`);
  if (d.anyDependency?.length) parts.push(`deps: ${d.anyDependency.join(', ')}`);
  if (d.anyFile?.length) parts.push(`files: ${d.anyFile.join(', ')}`);
  if (d.anyGlob?.length) parts.push(`globs: ${d.anyGlob.join(', ')}`);
  return parts.length ? parts.join(', ') : '—';
}
