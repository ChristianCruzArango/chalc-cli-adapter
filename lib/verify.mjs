// lib/verify.mjs — verificación de completitud de un proyecto creado/equipado por chalc + orquestación.
// Una sola responsabilidad: comprobar que están los artefactos que chalc deja (carpetas con README,
// docs/architecture.md, specs/, .chalc.json, archivo del asistente) y combinar eso con el linter de
// fronteras. Razón de cambio: lo que chalc emite. El análisis de imports vive en `verify-boundaries.mjs`.

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { lintBoundaries } from './verify-boundaries.mjs';

// Archivo de instrucciones que escribe cada target (asistente).
const ASSISTANT_FILE = {
  claude: 'CLAUDE.md',
  copilot: join('.github', 'copilot-instructions.md'),
  gemini: 'GEMINI.md',
  cursor: join('.cursor', 'rules'),
  codex: 'AGENTS.md'
};

// Comprueba los artefactos estructurales. `expectFolders` (opcional) son las carpetas de la arquitectura
// elegida: se valida que existan y que cada una traiga su README.md. Devuelve datos (no texto al usuario):
// [{ key, ok, items }] — `items` es la lista que falla (carpetas faltantes/sin README); la presentación la localiza.
function structureChecks(projectDir, { expectFolders, target }) {
  const has = (rel) => existsSync(join(projectDir, rel));
  const checks = [];
  if (Array.isArray(expectFolders) && expectFolders.length) {
    const missing = expectFolders.filter((f) => !has(f));
    const undocumented = expectFolders.filter((f) => has(f) && !has(join(f, 'README.md')));
    checks.push({ key: 'folders', ok: missing.length === 0, items: missing });
    checks.push({ key: 'folderDocs', ok: undocumented.length === 0, items: undocumented });
  }
  checks.push({ key: 'architectureDoc', ok: has(join('docs', 'architecture.md')), items: [] });
  checks.push({ key: 'specs', ok: has(join('specs', 'constitution.md')), items: [] });
  checks.push({ key: 'manifest', ok: has('.chalc.json'), items: [] });
  if (target && ASSISTANT_FILE[target]) {
    checks.push({ key: 'assistant', ok: has(ASSISTANT_FILE[target]), items: [] });
  }
  return checks;
}

// Lee el target del manifiesto (.chalc.json) cuando el llamador no lo conoce (p. ej. `chalc check`).
async function manifestTarget(projectDir) {
  try {
    return JSON.parse(await readFile(join(projectDir, '.chalc.json'), 'utf8')).target || null;
  } catch { return null; }
}

// Verifica un proyecto: completitud estructural + fronteras de arquitectura. Determinista, sin tokens.
// Devuelve { checks, violations, ok }.
export async function verifyProject(projectDir, { expectFolders = null, target = null } = {}) {
  const resolvedTarget = target || await manifestTarget(projectDir);
  const checks = structureChecks(projectDir, { expectFolders, target: resolvedTarget });
  const violations = await lintBoundaries(projectDir);
  return { checks, violations, ok: checks.every((c) => c.ok) && violations.length === 0 };
}
