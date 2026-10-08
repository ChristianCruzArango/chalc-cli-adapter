// Comando `chalc feature` (orquestador full-stack: HU → contrato + spec back + spec front) y su hand-off.

import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { t } from '../i18n.mjs';
import { configForTask, isConfigured } from '../ai.mjs';
import { orchestrateFeature } from '../featureorch.mjs';
import { contractFingerprint, contractStamp, stampFiles, sharedNumber, readContractLock } from '../specfolder.mjs';
import { safePull, createFeatureBranch } from '../gitprep.mjs';
import { appendAiTrace, makeAiTrace } from '../aitrace.mjs';
import { setTokenLogProject } from '../tokenlog.mjs';
import { c, cleanPath, flags, interactive, positional } from './context.mjs';
import { askExistingPath, makePrompter, startSpinner, stopSpinner } from './prompter.mjs';
import { equipForSpec } from './equip.mjs';
import { detectStackLabel, writeSideSpec } from './spec.mjs';
import { configureAi, printAiLine, resolveAiTaskConfig } from './ai.mjs';
import { acquireUserStory, askSpecLang } from './specgen.mjs';
import { exitCommand } from './exit.mjs';
import { featureHandoff } from './featurehandoff.mjs';
import { runFeatureWorktree } from './featureworktree.mjs';
import { askSddMode, backContextOf, featureSlug, orchestratorSides, readTarget, sideLabel, writeContract } from './featureshared.mjs';
import { SIDE } from '../sides.mjs';

export { featureHandoff, featureWorkspaceHandoff } from './featurehandoff.mjs';

// La IA de la tarea `spec`; la primera vez se configura aquí mismo si hay a quién preguntar.
async function featureAiConfig(prompter) {
  let cfg = await resolveAiTaskConfig('spec');
  if (!isConfigured(cfg)) {
    if (!prompter) { console.error(c.red('✗ ' + t('aiNotConfigured'))); exitCommand(1); }
    cfg = configForTask(await configureAi(prompter), 'spec');
  }
  return cfg;
}

// 1) Rutas: front y back obligatorias; móvil OPCIONAL (spec 003). Vacías o inexistentes: re-pregunta
// (no deja pasar). El móvil va por flag --movil/--mobile (R2) o preguntando (R1): es otro consumidor
// del mismo contrato.
async function askRepoPaths(prompter, opts) {
  const frontPath = positional[1] ? resolve(cleanPath(positional[1])) : (prompter ? await askExistingPath(prompter, t('featFrontQ')) : process.cwd());
  let backPath = flags.back ? resolve(cleanPath(String(flags.back))) : '';
  if (!backPath && prompter && (opts.assumeBack || await prompter.yesno(t('featHasBackQ'), true))) {
    backPath = await askExistingPath(prompter, t('featBackPathQ'));
  }
  if (!backPath) { if (prompter) prompter.close(); console.error(c.yellow('! ' + t('featNoBack'))); exitCommand(1); }
  const mobileFlag = flags.movil || flags.mobile;
  let mobilePath = mobileFlag ? resolve(cleanPath(String(mobileFlag))) : '';
  if (!mobilePath && prompter && await prompter.yesno(t('featHasMobileQ'), false)) {
    mobilePath = await askExistingPath(prompter, t('featMobilePathQ'));
  }
  for (const p of [frontPath, backPath, ...(mobilePath ? [mobilePath] : [])]) {
    if (!existsSync(p)) { if (prompter) prompter.close(); console.error(c.red('✗ ' + t('pathMissing', p))); exitCommand(1); }
  }
  return { frontPath, backPath, mobilePath };
}

// Identifica los stacks YA, para que el usuario confirme que reconoció bien cada repo antes de seguir (R3).
async function detectRepoStacks({ frontPath, backPath, mobilePath }) {
  const frontStack = await detectStackLabel(frontPath);
  const backStack = await detectStackLabel(backPath);
  const mobileStack = mobilePath ? await detectStackLabel(mobilePath) : '';
  const unknown = () => c.yellow(t('featUnknownStack'));
  console.log('  ' + c.green('✓') + ' ' + t('featDetect', frontStack || unknown(), backStack || unknown())
    + (mobilePath ? '  ·  ' + t('featDetectMobile', mobileStack || unknown()) : ''));
  if (!frontStack || !backStack || (mobilePath && !mobileStack)) console.log(c.dim('  ' + t('featUnknownHint')));
  return { frontStack, backStack, mobileStack };
}

// Modo de trabajo (spec 005, R1): repo sin rama (default, flujo actual) / repo con rama /
// worktrees aislados. --worktree y --branch/--no-branch lo fijan sin preguntar (R1, R2).
async function askWorkMode(prompter) {
  const fixed = flags.worktree ? 'worktree' : (flags.branch != null ? (flags.branch ? 'branch' : 'repo') : '');
  if (fixed || !prompter) return fixed || 'repo';
  const labels = [t('featModeRepo'), t('featModeBranch'), t('featModeWorktree')];
  return ['repo', 'branch', 'worktree'][await prompter.select(t('featModeQ'), labels.map((label) => ({ label })), 0)];
}

// 4) Estado Git PREVIO + readiness. El git va PRIMERO: equipar escribe archivos y ensuciaría el árbol,
// así que capturamos aquí el estado real (limpio/sucio) para decidir luego si es seguro crear la rama.
async function prepareRepos(sides, mode, specLang) {
  console.log('\n' + c.bold('🔎 ' + t('featReadiness')));
  const gitState = {};
  for (const [name, p] of sides) {
    const pull = await safePull(p);
    gitState[name] = pull;
    const mark = pull.ok ? c.green('✓') : c.yellow('!');
    console.log('  ' + mark + ' ' + t('featGit', sideLabel(name), t('gitReason_' + pull.reason.replace(/-/g, '_'))));
  }
  for (const [name, p] of sides) {
    const skills = await equipForSpec(p, mode, readTarget(p), specLang, { role: name });
    console.log('  ' + c.green('✓') + ' ' + t('featReadyRepo', sideLabel(name), skills.length));
  }
  return gitState;
}

// 8) Escribir: back (spec + contrato) y front (spec + copia del contrato para consumirlo).
// Un mismo NNN para ambos repos (IDs alineados front/back) en features nuevas; si un repo ya
// tenía la carpeta del slug, writeSideSpec la reúsa. El contrato se estampa en cada spec y se
// guarda un lock: así spec/plan/tasks NUNCA quedan desincronizados del contrato que los originó.
async function writeFeatureSpecs(result, sides, { cfg, slug }) {
  const fp = contractFingerprint(result.contract);
  const generatedAt = new Date().toISOString();
  const stamp = contractStamp(fp, generatedAt);
  const sharedNum = await sharedNumber(sides.map(([, p]) => join(p, 'specs')));
  const specs = { [SIDE.BACK]: result.back, [SIDE.FRONT]: result.front, [SIDE.MOBILE]: result.mobile };
  const outs = [];
  for (const [role, path] of [sides.find(([n]) => n === SIDE.BACK), ...sides.filter(([n]) => n !== SIDE.BACK)]) {
    outs.push([role, path, await writeSideSpec(path, slug, stampFiles(specs[role].files, stamp), sharedNum)]);
  }
  for (const [role, , out] of outs) {
    if (out.reused) console.log('  ' + c.yellow('!') + ' ' + t('featReusingFolder', sideLabel(role), out.id));
    const prev = await readContractLock(out.dest);
    if (prev && prev.contractHash !== fp) console.log('  ' + c.yellow('!') + ' ' + t('featContractRefreshed', sideLabel(role)));
    await writeContract(out, dirname(dirname(out.dest)), result.contract, { slug, contractHash: fp, generatedAt, role });
  }
  for (const [role, path, out] of outs) {
    const spec = specs[role];
    await appendAiTrace(path, out.id, makeAiTrace({ task: 'feature-' + role, provider: cfg.provider, model: cfg.model, system: spec.trace?.system, user: spec.trace?.user, output: spec.trace?.raw }));
  }
  for (const [role, , out] of outs) console.log((role === SIDE.BACK ? '\n' : '') + c.green('✓ ' + t('featSpecWritten', sideLabel(role), join(out.rel))));
  console.log(c.dim('  ' + t('featContractAt', 'contracts/api.md')));
  return Object.fromEntries(outs.map(([role, , out]) => [role, out]));
}

// 9) Rama de feature (opt-in), nombrada por el slug. SOLO se crea si el repo estaba limpio antes
// (si tenía cambios sin commitear, no la creo para no arrastrar tu trabajo pendiente). Los specs
// nuevos viajan con ella. TODO O NADA: la feature debe quedar en la MISMA rama en todos los repos
// (R7). Si alguno está sucio, no creo ninguna.
async function createBranches(sides, gitState, branchName) {
  const branchCreated = { [SIDE.FRONT]: false, [SIDE.BACK]: false, [SIDE.MOBILE]: false };
  const dirty = sides.filter(([name]) => gitState[name]?.reason === 'dirty').map(([name]) => sideLabel(name));
  if (dirty.length) {
    console.log('  ' + c.yellow('!') + ' ' + t('featBranchSkipDirty', dirty.join(' / ')));
    return branchCreated;
  }
  for (const [name, p] of sides) {
    const b = await createFeatureBranch(p, branchName);
    branchCreated[name] = b.ok;
    console.log('  ' + (b.ok ? c.green('✓') : c.yellow('!')) + ' ' + t('featBranch', sideLabel(name), b.branch, t('gitBranch_' + b.reason.replace(/-/g, '_'))));
  }
  return branchCreated;
}

// 6-7) Contexto del back y orquestación: contrato → spec back → spec front → spec móvil (si hay).
async function orchestrate({ cfg, userStory, specLang, mode, paths, stacks }) {
  const backContext = await backContextOf(paths.backPath);
  const inputs = await orchestratorSides({ ...paths, ...stacks }, mode, specLang);
  const spin = startSpinner(t('featOrchestrating', !!paths.mobilePath));
  try { return await orchestrateFeature({ cfg, userStory, language: specLang, mode, backContext, ...inputs }); }
  finally { stopSpinner(spin); }
}

// Hand-off ÚNICO del orquestador: un solo mensaje que coordina todos los repos alrededor del contrato.
function printHandoff({ backPath, frontPath, mobilePath }, outs, { branchName, branchCreated, specLang }) {
  console.log('\n' + c.bold(t('handoff')) + '\n');
  console.log(c.cyan(featureHandoff({
    backPath, backRel: outs[SIDE.BACK].rel, frontPath, frontRel: outs[SIDE.FRONT].rel,
    mobilePath, mobileRel: outs[SIDE.MOBILE]?.rel || '', branch: branchName,
    backBranchCreated: branchCreated[SIDE.BACK], frontBranchCreated: branchCreated[SIDE.FRONT],
    mobileBranchCreated: branchCreated[SIDE.MOBILE], specLang
  })) + '\n');
}

// ---------- comando: chalc feature (orquestador full-stack: HU → contrato + spec back + spec front) ----------
export async function runFeature(opts = {}) {
  console.log('\n' + c.bold('⚙️  ' + t('featHdr')) + '\n');
  const prompter = interactive ? makePrompter() : null;
  const cfg = await featureAiConfig(prompter);
  printAiLine(cfg);   // muestra qué proveedor/modelo se usará
  const paths = await askRepoPaths(prompter, opts);
  const { frontPath, backPath, mobilePath } = paths;
  // Los lados de la feature: clave interna + ruta.
  const sides = [[SIDE.FRONT, frontPath], [SIDE.BACK, backPath], ...(mobilePath ? [[SIDE.MOBILE, mobilePath]] : [])];
  setTokenLogProject(frontPath);   // el histórico de consumo del feature vive en el repo front (ver spec 002, fuera de alcance)
  const stacks = await detectRepoStacks(paths);
  const workMode = await askWorkMode(prompter);
  if (workMode === 'worktree') return runFeatureWorktree({ cfg, prompter, ...paths, ...stacks });

  // 2) Idioma del spec + modo (del back si está equipado). 3) HU.
  const specLang = await askSpecLang(prompter);
  const mode = await askSddMode(prompter, backPath);
  const userStory = await acquireUserStory(prompter);
  if (!userStory.trim()) { if (prompter) prompter.close(); console.error(c.red('✗ ' + t('docEmpty'))); exitCommand(1); }
  if (prompter) prompter.close();
  const gitState = await prepareRepos(sides, mode, specLang);

  const result = await orchestrate({ cfg, userStory, specLang, mode, paths, stacks });

  const slug = featureSlug(result);
  const outs = await writeFeatureSpecs(result, sides, { cfg, slug });
  const branchName = `feat/${slug}`;
  const branchCreated = workMode === 'branch' ? await createBranches(sides, gitState, branchName) : { [SIDE.FRONT]: false, [SIDE.BACK]: false, [SIDE.MOBILE]: false };
  if (workMode !== 'branch') console.log(c.dim('\n  ' + t('featBranchHint', branchName)));
  console.log('\n' + c.green('✓ ' + t('featDone', !!mobilePath)));

  printHandoff(paths, outs, { branchName, branchCreated, specLang });
}
