// Comando por defecto `chalc` (apply): detecta el stack, resuelve skills/MCP/métodos y los proyecta al target.

import { access } from 'node:fs/promises';
import { existsSync, constants } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { t } from '../i18n.mjs';
import { assertSafeId } from '../ids.mjs';
import { installSkill } from '../install.mjs';
import { detectContext, matchRules } from '../detect.mjs';
import { CATALOG, CHALC_ROOT, RULES_DIR, TARGETS_DIR, c, cleanPath, disp, dryRun, flags, force, allowExternalExec, interactive, methodFlags, projectPath } from './context.mjs';
import { deepSub, loadJsonDir, loadMcp, loadMethods, loadTargets } from './catalogstore.mjs';
import { makePrompter } from './prompter.mjs';
import { associate } from './configure.mjs';

// ---------- comando: chalc (apply) ----------
export async function runApply() {
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
