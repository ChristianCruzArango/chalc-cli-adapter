// lib/verify-boundaries.mjs — linter ESTÁTICO de fronteras de arquitectura (sin IA, sin tokens).
// Una sola responsabilidad: dado un proyecto, encontrar imports que rompen las reglas de capas que
// `chalc init` documenta (p. ej. `domain` no puede importar `infrastructure`; un feature no importa a otro).
// Razón de cambio: las reglas de capas y la sintaxis de import por lenguaje. Reutilizable por `chalc check`/CI.

import { readdir, readFile } from 'node:fs/promises';
import { join, dirname, posix } from 'node:path';

const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'build', 'out', 'target', 'obj', 'bin',
  '.next', '.nuxt', '.angular', '.dart_tool', '.gradle', '.idea', '.vscode',
  '.venv', 'venv', 'coverage', 'android', 'ios', 'macos', 'linux', 'windows', 'web'
]);

// Roles de capa conocidos (de las arquitecturas que genera chalc). Buckets = carpetas que agrupan unidades
// hermanas (cada subcarpeta es un feature/módulo independiente).
const LAYER_ROLES = new Set(['domain', 'application', 'data', 'infrastructure', 'presentation', 'features', 'feature', 'modules', 'core', 'shared', 'domains', 'layouts']);
const FEATURE_BUCKETS = new Set(['features', 'feature', 'modules', 'domains']);

// Capas que cada capa NO debe importar (invariantes de alta confianza; data-driven para extender sin tocar lógica).
const FORBIDDEN_IMPORTS = {
  domain: ['application', 'data', 'infrastructure', 'presentation', 'features', 'feature', 'modules', 'layouts'],
  application: ['data', 'infrastructure', 'presentation'],
  core: ['features', 'feature', 'modules', 'presentation', 'application', 'data', 'infrastructure'],
  shared: ['features', 'feature', 'modules', 'presentation', 'application', 'data', 'infrastructure']
};

const SOURCE_FILE = /\.(ts|tsx|js|jsx|mjs|cjs|dart)$/;
const GENERATED_OR_TEST = /(\.spec\.|\.test\.|_test\.|\.g\.dart$|\.freezed\.dart$|\.mocks\.dart$)/;

// La capa (y feature, si aplica) de una ruta, según el primer segmento que sea un rol de capa.
export function layerOf(relPath) {
  const segments = String(relPath).split('/').filter(Boolean);
  for (let i = 0; i < segments.length; i++) {
    if (LAYER_ROLES.has(segments[i])) {
      const feature = FEATURE_BUCKETS.has(segments[i]) ? (segments[i + 1] || null) : null;
      return { layer: segments[i], feature };
    }
  }
  return { layer: null, feature: null };
}

// Rutas importadas en el contenido, según la sintaxis del lenguaje.
export function extractImports(content, ext) {
  const text = String(content || '');
  const paths = [];
  if (ext === 'dart') {
    for (const m of text.matchAll(/(?:import|export)\s+['"]([^'"]+)['"]/g)) paths.push(m[1]);
  } else {
    for (const m of text.matchAll(/(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g)) paths.push(m[1]);
    for (const m of text.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) paths.push(m[1]);
  }
  return paths;
}

// La capa a la que apunta un import. Relativo → se resuelve contra la carpeta del archivo; con alias/absoluto
// → se busca un rol de capa entre sus segmentos. Esquemas de SDK (dart:async, etc.) se ignoran.
function importTarget(importPath, fileRelPath) {
  const isScheme = /^[a-z][a-z0-9+.-]*:/i.test(importPath) && !importPath.startsWith('package:');
  if (isScheme) return { layer: null, feature: null };
  if (importPath.startsWith('.')) return layerOf(posix.normalize(posix.join(dirname(fileRelPath), importPath)));
  return layerOf(importPath);
}

// Recorre el proyecto y devuelve rutas de fuentes (relativas, con '/'), saltando carpetas pesadas y archivos de test/generados.
async function sourceFiles(projectDir, max = 5000) {
  const found = [];
  async function walk(absDir, relDir) {
    if (found.length >= max) return;
    let entries = [];
    try { entries = await readdir(absDir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const childRel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) await walk(join(absDir, entry.name), childRel);
      } else if (SOURCE_FILE.test(entry.name) && !GENERATED_OR_TEST.test(entry.name)) {
        found.push(childRel);
      }
    }
  }
  await walk(projectDir, '');
  return found;
}

// ¿El import apunta a la MISMA unidad que el archivo (misma capa y mismo feature)? Entonces no cruza frontera.
function sameUnit(source, target) {
  return target.layer === source.layer && target.feature === source.feature;
}

// Encuentra las violaciones de frontera. Una por import que rompe FORBIDDEN_IMPORTS o que cruza features.
// Devuelve [{ file, from, to, import, kind: 'layer' | 'feature' }].
export async function lintBoundaries(projectDir) {
  const violations = [];
  for (const relPath of await sourceFiles(projectDir)) {
    const source = layerOf(relPath);
    if (!source.layer) continue;                          // archivo fuera de una capa: no aplica
    let content = '';
    try { content = await readFile(join(projectDir, relPath), 'utf8'); } catch { continue; }
    const ext = relPath.split('.').pop();
    for (const importPath of extractImports(content, ext)) {
      const target = importTarget(importPath, relPath);
      if (!target.layer || sameUnit(source, target)) continue;
      if ((FORBIDDEN_IMPORTS[source.layer] || []).includes(target.layer)) {
        violations.push({ file: relPath, from: source.layer, to: target.layer, import: importPath, kind: 'layer' });
      } else if (source.feature && target.feature && source.layer === target.layer && source.feature !== target.feature) {
        violations.push({ file: relPath, from: `${source.layer}/${source.feature}`, to: `${target.layer}/${target.feature}`, import: importPath, kind: 'feature' });
      }
    }
  }
  return violations;
}
