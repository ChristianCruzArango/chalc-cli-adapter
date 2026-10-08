// `chalc feature` en modo worktree (spec 005): puerta → HUs → workspaces aislados por HU.
// Cada HU termina en <base>/NNN-slug/ con un worktree por repo (back/, front/, movil/) sobre la
// rama feat/<slug>, sus specs DENTRO y el hand-off en la raíz. El árbol principal de cada repo
// queda intacto (R9). chalc nunca ejecuta agentes, ni commitea, ni borra worktrees.

import { writeFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { t } from '../i18n.mjs';
import { orchestrateFeatures } from '../featureorch.mjs';
import { contractFingerprint, contractStamp, stampFiles, sharedNumber } from '../specfolder.mjs';
import { workspaceGate, planWorkspace, createWorkspace, writeHandoff, rememberWorkspaceDir, recallWorkspaceDir, workspaceBaseDir } from '../workspace.mjs';
import { findDuplicateRoutes } from '../contractlint.mjs';
import { openAllScript, launchTerminals } from '../terminals.mjs';
import { sidesFor } from '../sides.mjs';
import { writeSides } from '../sidesemit.mjs';
import { appendAiTrace, makeAiTrace } from '../aitrace.mjs';
import { c, cleanPath, disp, flags, interactive } from './context.mjs';
import { makePrompter, startSpinner, stopSpinner } from './prompter.mjs';
import { equipForSpec } from './equip.mjs';
import { writeSideSpec } from './spec.mjs';
import { acquireUserStory, askSpecLang } from './specgen.mjs';
import { exitCommand } from './exit.mjs';
import { featureWorkspaceHandoff } from './featurehandoff.mjs';
import { askSddMode, backContextOf, featureSlug, orchestratorSides, readTarget, sideLabel, writeContract } from './featureshared.mjs';
import { SIDE } from '../sides.mjs';

// 1) Puerta bloqueante (R3, R4): ni un token ni un archivo hasta que TODOS los repos pasen.
//    En interactivo se re-verifica cuando el usuario resuelva; en no interactivo, aborta.
async function passGate(prompter, wsSides) {
  console.log('\n' + c.bold('🔎 ' + t('featGateHdr')));
  for (;;) {
    const gate = await workspaceGate(wsSides);
    for (const r of gate.results) {
      console.log('  ' + (r.ok ? c.green('✓') : c.yellow('!')) + ' ' + t('featGit', sideLabel(r.name), t('gitReason_' + r.reason.replace(/-/g, '_'))));
    }
    if (gate.ok) return;
    if (!prompter || !(await prompter.yesno(t('featGateRetryQ'), true))) {
      if (prompter) prompter.close();
      console.error(c.yellow('! ' + t('featGateAbort')));
      exitCommand(1);
    }
  }
}

// 3) Captura multi-HU (R5): una o más historias ANTES de generar nada. No interactivo: una sola (por flags).
async function askStories(prompter) {
  const userStories = [];
  do {
    if (prompter) console.log('\n' + c.bold('📝 ' + t('featHuLabel', userStories.length + 1)));
    const hu = await acquireUserStory(prompter);
    if (hu.trim()) userStories.push(hu);
  } while (prompter && await prompter.yesno(t('featAnotherHuQ'), false));
  if (!userStories.length) { if (prompter) prompter.close(); console.error(c.red('✗ ' + t('docEmpty'))); exitCommand(1); }
  return userStories;
}

// 4) Carpeta base de workspaces (R8): flag > recordada > hermana del back. Escriba lo que
//    escriba el usuario, se trabaja SIEMPRE dentro de <ruta>/chalc-workspaces (normalizado,
//    sin duplicar). Se recuerda para corridas futuras y para el dashboard (spec 006).
async function askWorkspaceDir(prompter, backPath) {
  let baseDir = flags['workspace-dir'] ? workspaceBaseDir(resolve(cleanPath(String(flags['workspace-dir'])))) : '';
  if (!baseDir) {
    const def = (await recallWorkspaceDir()) || workspaceBaseDir(dirname(backPath));
    if (prompter) {
      const ans = (await prompter.text(t('featWorkspaceDirQ') + ' ' + c.dim(`[${disp(def)}]`) + ':')).trim();
      baseDir = ans ? workspaceBaseDir(resolve(cleanPath(ans))) : def;
    } else { baseDir = def; }
  }
  await rememberWorkspaceDir(baseDir);
  return baseDir;
}

// Un lado dentro de su worktree: skills y portón (spec 005 R9, spec 007 R15), la vista del workspace
// (spec 010, R2: quién posee el contrato, dónde están los hermanos y el buzón — solo aquí se sabe),
// la spec, el contrato y la traza.
async function placeSide(side, plan, { spec, slug, num, stamp, lock, contract, cfg, mode, specLang }) {
  await equipForSpec(side.dest, mode, readTarget(side.repo), specLang, { role: side.name });
  await writeSides(side.dest, sidesFor(side.name, plan.sides.map((x) => x.name)));
  const out = await writeSideSpec(side.dest, slug, stampFiles(spec.files, stamp), num);
  await writeContract(out, side.dest, contract, { ...lock, role: side.name });
  await appendAiTrace(side.dest, out.id, makeAiTrace({ task: 'feature-' + side.name, provider: cfg.provider, model: cfg.model, system: spec.trace?.system, user: spec.trace?.user, output: spec.trace?.raw }));
  return out;
}

// 7) Colocación de UNA HU: workspace + worktrees (todo-o-nada, R10) y TODO dentro del worktree (R9).
// Devuelve el workspace colocado, o null si no se pudo (las demás HUs siguen).
async function placeStory(r, num, { baseDir, wsSides, generatedAt, cfg, mode, specLang, hasMobile }) {
  const slug = featureSlug(r);
  const id = `${num}-${slug}`;
  const branchName = `feat/${slug}`;
  const plan = planWorkspace(baseDir, id, wsSides);
  const created = await createWorkspace(plan, branchName);
  if (!created.ok) {
    const detail = created.failures.map((f) => `${sideLabel(f.name)}: ${f.reason}`).join(' · ');
    console.log('  ' + c.yellow('!') + ' ' + t('featWorkspaceFailed', id, detail));
    return null;
  }
  const fp = contractFingerprint(r.contract);
  const ctx = { slug, num, stamp: contractStamp(fp, generatedAt), lock: { slug, contractHash: fp, generatedAt }, contract: r.contract, cfg, mode, specLang };
  const sideResults = { [SIDE.BACK]: r.back, [SIDE.FRONT]: r.front, [SIDE.MOBILE]: r.mobile };
  const outs = {};
  for (const side of plan.sides) outs[side.name] = await placeSide(side, plan, { ...ctx, spec: sideResults[side.name] });
  // El hand-off apunta a la carpeta REAL de la spec: si la rama ya traía una del mismo slug,
  // writeSideSpec la reutiliza y su número no es el del workspace.
  const handoffText = featureWorkspaceHandoff({ id: outs.back.id, branch: branchName, specLang, hasMobile });
  await writeHandoff(plan.dir, handoffText);
  console.log('  ' + c.green('✓') + ' ' + t('featWorkspaceCreated', id, disp(plan.dir)));
  return { id, branch: branchName, dir: plan.dir, handoff: handoffText, contract: r.contract };
}

// 9) Tabla resumen + hand-offs (R11): además del archivo, cada prompt se imprime bajo su
//    separador — listo para pegar en su panel, igual que el flujo individual.
function printWorkspaces(workspaces) {
  console.log('\n' + c.bold(t('featWsTableHead')));
  for (const w of workspaces) console.log(`  ${w.id}  ·  ${w.branch}  ·  ${disp(w.dir)}`);
  console.log(c.dim('  ' + t('featHandoffAt')));
  console.log('\n' + c.bold(t('handoff')));
  for (const w of workspaces) {
    console.log('\n' + c.bold(`────────── ${w.id} ──────────`));
    console.log(c.cyan(w.handoff));
  }
}

// 10) Terminales (R12, R13): el script se escribe SIEMPRE; la ventana solo si el usuario quiere.
async function offerTerminals(baseDir, workspaces) {
  const script = openAllScript(workspaces.map(({ id, dir }) => ({ id, dir })));
  const scriptPath = join(baseDir, script.name);
  await writeFile(scriptPath, script.content, 'utf8');
  let wantTerminals = flags.terminals;
  if (wantTerminals == null && interactive) {
    const p2 = makePrompter();   // el prompter original se cerró antes de generar
    wantTerminals = await p2.yesno(t('featTerminalsQ'), true);
    p2.close();
  }
  if (wantTerminals) launchTerminals(workspaces.map(({ id, dir }) => ({ id, dir })));
  console.log(c.dim('  ' + t('featOpenAllHint', disp(scriptPath))));
}

export async function runFeatureWorktree({ cfg, prompter, backPath, frontPath, mobilePath, backStack, frontStack, mobileStack }) {
  // Lados en el ORDEN del workspace: el back manda el contrato; las carpetas serán back/, front/, movil/.
  const wsSides = [{ name: SIDE.BACK, path: backPath }, { name: SIDE.FRONT, path: frontPath }, ...(mobilePath ? [{ name: SIDE.MOBILE, path: mobilePath }] : [])];
  await passGate(prompter, wsSides);
  // 2) Idioma del spec + modo SDD (mismos criterios que el camino normal).
  const specLang = await askSpecLang(prompter);
  const mode = await askSddMode(prompter, backPath);
  const userStories = await askStories(prompter);
  const baseDir = await askWorkspaceDir(prompter, backPath);
  if (prompter) prompter.close();

  // 5) Generar TODAS las HUs en secuencia (R7: cada contrato ve los previos). Las plantillas se
  //    leen de los repos principales; si un repo no está equipado, cae al catálogo (R9).
  const backContext = await backContextOf(backPath);
  const sides = await orchestratorSides({ backPath, frontPath, mobilePath, backStack, frontStack, mobileStack }, mode, specLang);
  const spin = startSpinner(t('featOrchestrating', !!mobilePath));
  let results;
  try { results = await orchestrateFeatures({ cfg, userStories, language: specLang, mode, backContext, ...sides }); }
  finally { stopSpinner(spin); }

  // 6) Reserva de números (R6): base compartida una vez; +1 por HU en memoria (los repos
  //    principales no cambian durante la corrida, re-consultar el disco daría siempre el mismo).
  const baseNum = parseInt(await sharedNumber(wsSides.map(({ path }) => join(path, 'specs'))), 10);
  console.log('');
  const ctx = { baseDir, wsSides, generatedAt: new Date().toISOString(), cfg, mode, specLang, hasMobile: !!mobilePath };
  const workspaces = [];
  for (let i = 0; i < results.length; i++) {
    const placed = await placeStory(results[i], String(baseNum + i).padStart(3, '0'), ctx);
    if (placed) workspaces.push(placed);
  }
  // 8) Lint de rutas entre HUs (R7): advertencia, nunca aborta.
  for (const dup of findDuplicateRoutes(workspaces.map(({ id, contract }) => ({ id, contract })))) {
    console.log('  ' + c.yellow('!') + ' ' + t('featDupRoute', dup.method, dup.path, dup.ids.join(' / ')));
  }
  if (!workspaces.length) { console.error(c.red('✗ ' + t('featGateAbort'))); exitCommand(1); }
  printWorkspaces(workspaces);
  await offerTerminals(baseDir, workspaces);
  console.log('\n' + c.green('✓ ' + t('featDone', !!mobilePath)));
}
