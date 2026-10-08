// Comando por defecto `chalc` (apply): detecta el stack, resuelve skills/MCP/métodos y los proyecta al target.

import { access } from 'node:fs/promises';
import { existsSync, constants } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { t } from '../i18n.mjs';
import { assertSafeId } from '../ids.mjs';
import { installSkill } from '../install.mjs';
import { detectContext, matchRules } from '../detect.mjs';
import { CATALOG, CHALC_ROOT, TARGETS_DIR, c, cleanPath, disp, dryRun, flags, force, allowExternalExec, interactive, methodFlags, projectPath, assumeYes } from './context.mjs';
import { loadMcp, loadMethods, loadTargets, loadRules } from './catalogstore.mjs';
import { makePrompter } from './prompter.mjs';
import { associate } from './configure.mjs';
import { applyEquipment, loadTargetModule, resolveMcps } from './equip.mjs';
import { exitCommand } from './exit.mjs';

// ---------- comando: chalc (apply) ----------
// Valida una ruta candidata; devuelve null si es válida, o una función que imprime el error.
async function validatePath(p) {
  if (p === CHALC_ROOT) return () => console.log(c.yellow('• ' + t('notChalcFolder')));
  if (!existsSync(p)) return () => console.log(c.red('✗ ' + t('pathMissing', p)));
  try { await access(p, constants.W_OK); } catch {
    return () => {
      console.log(c.red('✗ ' + t('pathNotWritable', p)));
      console.log(c.dim(`  sudo chown -R "$(whoami)" "${p}"`));
    };
  }
  return null;
}

// 0) ruta del proyecto: en interactivo se pregunta y se re-pregunta hasta que sea válida
async function askProjectPath(prompter, proj) {
  if (!prompter) {
    console.log('\n' + c.bold('⚙️  chalc') + c.dim(`  ·  ${disp(proj)}`) + (dryRun ? c.dim('  (dry-run)') : '') + '\n');
    const err = await validatePath(proj);
    if (err) { err(); exitCommand(1); }
    return proj;
  }
  console.log('\n' + c.bold('⚙️  chalc') + (dryRun ? c.dim('  (dry-run)') : '') + '\n');
  console.log(c.dim('  ' + t('pathHint')));
  while (true) {
    const def = proj === CHALC_ROOT ? '' : proj;     // no ofrecer la carpeta de chalc como default
    const ans = await prompter.text(`${t('pathQ')} ${def ? c.dim(`[${def}]`) : ''}:`);
    const candidate = ans ? resolve(cleanPath(ans)) : (def ? proj : CHALC_ROOT);
    const err = await validatePath(candidate);
    if (!err) return candidate;
    err();
  }
}

// 1) detectar
async function detectStacks(proj) {
  const ctx = await detectContext(proj);
  const rules = await loadRules();
  const matched = matchRules(rules, ctx);
  const stacks = matched.filter((r) => !r.always);          // para mostrar (Global no es un stack)
  const langs = [...new Set(stacks.map((r) => r.language).filter(Boolean))];
  if (stacks.length) {
    console.log(c.green('✓ ') + c.bold(stacks.map((r) => r.name).join(' + ')) + (langs.length ? c.dim('   ·   ' + langs.join(', ')) : '') + '\n');
  } else {
    console.log(c.yellow('• ' + t('noStack')) + '\n');
  }
  return { ctx, rules, matched, stacks };
}

// 2) asistente destino (solo los que existen en targets/)
async function pickTarget(prompter) {
  const targetOptions = (await loadTargets()).map((tg) => ({ label: tg.label, value: tg.id }));
  let targetName = String(flags.target || 'claude');
  if (prompter) {
    const di = Math.max(0, targetOptions.findIndex((o) => o.value === targetName));
    targetName = targetOptions[await prompter.select(t('assistantQ'), targetOptions, di)].value;
  }
  targetName = assertSafeId(targetName, 'target');
  const targetFile = join(TARGETS_DIR, `${targetName}.mjs`);
  if (!existsSync(targetFile)) {
    if (prompter) prompter.close();
    console.error(c.red('✗ ' + t('targetMissing', targetName))); exitCommand(1);
  }
  return { targetName, targetFile };
}

// 3) equipar skills + mcp (de las reglas que matchean, incluida la global)
async function pickEquipment(prompter, matched, stacks) {
  if (!matched.length) return { skills: [], mcpIds: [] };
  if (prompter && !await prompter.yesno(t('equipQ', stacks.map((r) => r.name).join(' + ') || t('thisProject')), true)) return { skills: [], mcpIds: [] };
  const skills = [...new Set(matched.flatMap((r) => r.skills || []))];
  const mcpIds = [...new Set(matched.flatMap((r) => r.mcp || []))];
  const optionalIds = [...new Set(matched.flatMap((r) => r.optionalMcp || []))].filter((id) => !mcpIds.includes(id));
  for (const id of optionalIds) {
    const def = await loadMcp(id);
    if (prompter && await prompter.yesno(t('optionalMcpQ', c.bold(id), def.description), false)) mcpIds.push(id);
  }
  return { skills, mcpIds };
}

// 4) instalar skills nuevos desde URL (interactivo) — los cablea a una regla y los equipa ya
async function installNewSkills(prompter, rules, skills) {
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

function pickModeNonInteractive(m, flagEntry) {
  if (flagEntry && flagEntry.includes(':')) return m.modes.find((x) => x.id === flagEntry.split(':')[1]) || m.modes[0];
  if (flags.mode) return m.modes.find((x) => x.id === String(flags.mode)) || m.modes[0];
  return m.modes[0];
}

// Un método: si se quiere (flag o pregunta), con su explicador y su modo. null si no.
async function pickMethod(prompter, m) {
  const flagEntry = methodFlags.find((f) => f === m.id || f.startsWith(m.id + ':'));
  const want = prompter ? await prompter.yesno(t('methodQ', c.bold(m.label), m.description), false) : !!flagEntry;
  if (!want) return null;
  if (prompter && m.explainText) {
    console.log(c.cyan(m.explainText));
    if (!await prompter.yesno(t('methodConfirm'), true)) { console.log(c.dim('  · ' + t('methodSkipped') + '\n')); return null; }
  }
  let mode = m.modes[0];
  if (m.modes.length > 1) {
    mode = prompter ? m.modes[await prompter.select(t('sizeQ'), m.modes.map((x) => ({ label: x.label })), 0)] : pickModeNonInteractive(m, flagEntry);
  }
  return { id: m.id, label: m.label, mode: mode.id, scaffoldDir: mode.scaffoldDir, rulesText: mode.rulesText };
}

// 6) confirmar
async function confirmApply(prompter, { targetName, skills, mcpIds, methods }) {
  console.log('\n' + c.bold(t('summary')));
  console.log(`  ${t('sAssistant')} : ${targetName}`);
  console.log(`  ${t('sSkills')} : ${skills.length}`);
  console.log(`  ${t('sMcp')} : ${mcpIds.length ? mcpIds.join(', ') : '—'}`);
  console.log(`  ${t('sMethods')} : ${methods.length ? methods.map((m) => `${m.id} (${m.mode})`).join(', ') : '—'}\n`);
  const go = await prompter.yesno(dryRun ? t('showQ') : t('applyQ'), true);
  prompter.close();
  if (!go) { console.log(c.dim('\n' + t('cancelled') + '\n')); exitCommand(0); }
}

// 7) aplicar. Los roles van SIEMPRE con el portón: gate.json los exige, y un rol exigido que el
// target no instaló deja al advisor pidiendo `call_role` a un agente que no existe.
async function applyTarget(proj, ctx, { targetName, skills, mcpIds, methods, stacks }) {
  const mcps = await resolveMcps(mcpIds);
  const target = await loadTargetModule(targetName);
  const { plan } = await applyEquipment(proj, target, { targetName, ctx, skills, mcps, methods, stacks, dryRun });
  console.log('\n' + c.bold(dryRun ? t('planDry') : t('applied')));
  for (const line of plan) console.log('  ' + (dryRun ? c.dim('· ') : c.green('✓ ')) + line);
  if (!dryRun) {
    console.log('\n' + c.green(t('done', skills.length, mcps.length, methods.length, target.label || targetName)));
    console.log(c.dim(t('manifest', join(basename(proj), '.chalc.json')) + '\n'));
  } else {
    console.log('\n' + c.dim(t('removeDryrun') + '\n'));
  }
}

export async function runApply() {
  // Sin terminal (CI, una tubería, una tarea del IDE) no hay a quién preguntar: equipar en silencio
  // `process.cwd()` —que puede ser `$HOME` o la raíz de un monorepo— exige pedirlo con `--yes`.
  if (!interactive && !assumeYes && !dryRun) {
    console.error(c.red('✗ ' + t('applyNeedsYes', disp(projectPath))));
    exitCommand(2);
  }
  const prompter = interactive ? makePrompter() : null;
  const proj = await askProjectPath(prompter, projectPath);
  console.log(c.dim(`  ${t('project')}: ${disp(proj)}`));
  const { ctx, rules, matched, stacks } = await detectStacks(proj);
  const { targetName } = await pickTarget(prompter);
  const { skills, mcpIds } = await pickEquipment(prompter, matched, stacks);
  if (prompter) await installNewSkills(prompter, rules, skills);
  // 5) métodos (SDD, etc.) — explicador + modo
  const methods = [];
  for (const m of await loadMethods()) {
    const picked = await pickMethod(prompter, m);
    if (picked) methods.push(picked);
  }
  if (prompter) await confirmApply(prompter, { targetName, skills, mcpIds, methods });
  await applyTarget(proj, ctx, { targetName, skills, mcpIds, methods, stacks });
}
