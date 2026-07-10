// Equipamiento de proyectos: scaffold SDD y proyección de skills/MCP/métodos vía el target.
// Lo reutilizan apply, spec, spec-ia, feature e init.

import { cp, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { lang } from '../i18n.mjs';
import { assertSafeId } from '../ids.mjs';
import { detectContext, matchRules } from '../detect.mjs';
import { CATALOG, METHODS_DIR, RULES_DIR, TARGETS_DIR } from './context.mjs';
import { deepSub, langCode, loadJsonDir, loadMcp, loadMethods } from './catalogstore.mjs';

export async function ensureSddScaffold(projectPath, mode = 'lite') {
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
export async function equipForSpec(proj, mode, targetName, specLang) {
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

export async function equipCreatedProject(proj, { targetName = 'claude', methodMode = 'lite', extraSkills = [], architecture = null } = {}) {
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
