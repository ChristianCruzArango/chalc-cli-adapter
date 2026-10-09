// Comandos `chalc init` (proyecto desde cero con decisión arquitectónica guiada) y
// `chalc verify` (verificación determinista), con sus helpers de scaffold/verificación.

import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { t } from '../i18n.mjs';
import { assertSafeId } from '../ids.mjs';
import { architectureSkills, archText, dartPackageName, getStack, listStacks, mandatoryPrinciples, resolveScaffoldTool, scaffoldSteps, slugifyProjectName, verifySteps } from '../init.mjs';
import { contentLang } from '../contentlang.mjs';
import { reshapeProject } from '../init-scaffold.mjs';
import { setTokenLogProject } from '../tokenlog.mjs';
import { verifyProject } from '../verify.mjs';
import { portable } from '../proc.mjs';
import { c, cleanPath, dryRun, flags, allowExternalExec, interactive, positional } from './context.mjs';
import { loadTargets } from './catalogstore.mjs';
import { makePrompter } from './prompter.mjs';
import { equipCreatedProject } from './equip.mjs';
import { exitCommand } from './exit.mjs';
import { askProposal, decideArchitecture } from './initarch.mjs';

// Corre un paso del scaffolder/verify con salida visible. cwd: 'project' = dentro de <dest>; si no, en el padre.
export function runInitStep(step, { parentDir, projectDir }) {
  return new Promise((res) => {
    const cwd = step.cwd === 'project' ? projectDir : parentDir;
    // shell:true en Windows: npx/npm/flutter son shims .cmd/.bat y spawn no los resuelve sin shell (ENOENT).
    const child = spawn(...portable(step.command, step.args, { cwd, stdio: 'inherit', env: { ...process.env, NG_CLI_ANALYTICS: 'false' } }));
    child.on('error', (e) => res({ code: -1, error: e }));
    child.on('exit', (code) => res({ code: code ?? -1 }));
  });
}

// Lee la versión del Flutter instalado en la máquina (la que usará `flutter create`). null si no está en PATH.
export function detectFlutterVersion() {
  return new Promise((res) => {
    try {
      let out = '';
      const child = spawn(...portable('flutter', ['--version'], { stdio: ['ignore', 'pipe', 'ignore'] }));
      child.stdout.on('data', (d) => { out += d; });
      child.on('error', () => res(null));
      child.on('exit', () => { const m = out.match(/Flutter\s+(\d+\.\d+\.\d+)/i); res(m ? m[1] : null); });
    } catch { res(null); }
  });
}

// Etiqueta i18n de cada chequeo estructural (la capa de datos devuelve solo `key`).
const VERIFY_LABEL = { folders: 'vChkFolders', folderDocs: 'vChkFolderDocs', architectureDoc: 'vChkArchitectureDoc', specs: 'vChkSpecs', manifest: 'vChkManifest', assistant: 'vChkAssistant' };

// Presenta (localizado) el resultado de verifyProject: chequeos estructurales + fronteras. Devuelve si pasó.
export function printVerification(result) {
  console.log('\n' + c.bold('🔎 ' + t('verifyHdr')));
  for (const ch of result.checks) {
    const extra = (!ch.ok && ch.items?.length) ? c.dim('  · ' + t('vMissing', ch.items.join(', '))) : '';
    console.log('  ' + (ch.ok ? c.green('✓') : c.yellow('✗')) + ' ' + t(VERIFY_LABEL[ch.key] || ch.key) + extra);
  }
  if (!result.violations.length) {
    console.log('  ' + c.green('✓') + ' ' + t('vBoundariesOk'));
  } else {
    console.log('  ' + c.yellow('✗') + ' ' + t('vBoundariesBad', result.violations.length));
    for (const v of result.violations.slice(0, 20)) console.log(c.dim('      · ' + t('vViolation', v.file, v.from, v.to)));
  }
  return result.ok;
}

// ---------- comando: chalc init ----------
// 1) Stack (lenguaje/framework). Buscador automático cuando la lista crezca; con pocos, selector simple.
async function askStack(prompter) {
  const stacks = listStacks();
  let stackId = String(positional[1] || flags.stack || '').trim().toLowerCase();
  if (prompter && !stackId) {
    stackId = stacks[await prompter.select(t('initStackQ'), stacks.map((s) => ({ label: s.label })), 0, { search: stacks.length > 6 })].id;
  }
  if (!stackId) stackId = 'angular';
  if (!getStack(stackId)) throw new Error(t('initStackUnsupported', stackId, stacks.map((s) => s.id).join(', ')));
  return stackId;
}

// 2) Nombre del proyecto. Flutter/Dart exige nombre de paquete en snake_case (rechaza guiones): se
// aplica al nombre y a la carpeta.
async function askProjectName(prompter, stackId) {
  let projectName = slugifyProjectName(flags.name || positional[2] || '');
  if (prompter && (!projectName || projectName === 'chalc-app')) {
    projectName = slugifyProjectName(await prompter.text(t('initNameQ')));
  }
  if (!projectName) projectName = 'chalc-app';
  return stackId === 'flutter' ? dartPackageName(projectName) : projectName;
}

// 2b) Ubicación: carpeta padre donde se creará <projectName>. Default = directorio actual.
async function askBaseDir(prompter) {
  let baseDir = String(flags.dir || '').trim() ? resolve(cleanPath(String(flags.dir))) : process.cwd();
  if (prompter) {
    const ans = (await prompter.text(t('initDirQ', baseDir))).trim();
    if (ans) baseDir = resolve(cleanPath(ans));
  }
  return baseDir;
}

// 5) Target (asistente de IA).
async function askInitTarget(prompter) {
  let targetName = String(flags.target || 'claude');
  const targetOptions = (await loadTargets()).map((tgt) => ({ label: tgt.label, value: tgt.id }));
  if (prompter) {
    const di = Math.max(0, targetOptions.findIndex((o) => o.value === targetName));
    targetName = targetOptions[await prompter.select(t('initAssistantQ'), targetOptions, di)].value;
  }
  return assertSafeId(targetName, 'target');
}

async function printInitSummary({ dest, decision, steps, stackId, targetName, doVerify }) {
  console.log('\n' + c.bold(t('initSummary')));
  console.log(`  ${t('initSumProject')}: ${dest}`);
  console.log(`  ${t('initSumStack')}: ${decision.stackLabel}`);
  console.log(`  ${t('initSumArch')}: ${archText(decision.architecture.label)}`);
  console.log(`  ${t('initSumScaffolder')}: ${steps.map((s) => `${s.command} ${s.args.slice(0, 4).join(' ')}…`).join(' · ')}`);
  const tool = resolveScaffoldTool(stackId);
  if (tool) {
    const node = process.version.replace(/^v/, '');
    const pinned = tool.tag !== 'latest';
    console.log(`  ${t('initSumToolchain')}: ${tool.pkg}@${tool.tag}` + (pinned ? c.dim('  · ' + t('initToolPinned', node)) : ''));
  }
  // Flutter usa el SDK instalado en tu máquina: mostramos esa versión (o avisamos si no está en PATH).
  if (stackId === 'flutter') {
    const fv = await detectFlutterVersion();
    console.log(`  ${t('initSumToolchain')}: ` + (fv ? `flutter ${fv}` + c.dim('  · ' + t('initFlutterLocal')) : c.yellow(t('initFlutterMissing'))));
  }
  // Consola en el idioma de la interfaz (con `--lang`, ese mismo: R39).
  console.log(`  ${t('initSumPrinciples')}: ${mandatoryPrinciples().slice(0, 4).join(', ')} ${t('initSumAlways')}`);
  console.log(`  ${t('initSumTarget')}: ${targetName}${doVerify ? c.dim('  · ' + t('initWithVerify')) : ''}`);
}

function printInitDryRun(steps, targetName, doVerify) {
  console.log(c.dim('\n' + t('initDryHdr')));
  steps.forEach((s) => console.log(c.dim(`  ▶ ${s.command} ${s.args.join(' ')}`)));
  console.log(c.dim(`  ▶ ${t('initDryFolders')}`));
  console.log(c.dim(`  ▶ ${t('initDryEquip', targetName, doVerify)}\n`));
}

// 6) Scaffolder oficial (ng new / nest new / dotnet new). Aseguramos la carpeta padre (cwd del scaffolder).
// Solo si no existe: en Windows, mkdir sobre la raíz del disco (p. ej. D:\, padre de D:\prueba) lanza EPERM.
async function runScaffold(steps, { parentDir, dest }) {
  if (!existsSync(parentDir)) await mkdir(parentDir, { recursive: true });
  if (steps.some((s) => s.cwd === 'project')) await mkdir(dest, { recursive: true });
  for (const step of steps) {
    console.log('\n▶ ' + c.bold(step.label) + c.dim(`  · ${step.command} ${step.args.join(' ')}`));
    const r = await runInitStep(step, { parentDir, projectDir: dest });
    if (r.code !== 0) throw new Error(t('initScaffoldFail', step.label, r.error?.code || r.error?.message || t('scaffoldExitCode', r.code), step.command));
  }
  if (!existsSync(dest)) throw new Error(t('initScaffoldNoDir', dest));
}

// 10) Build check opcional (--verify). El «✓» solo si TODOS los pasos pasaron: antes se imprimía
// también tras un build fallido.
async function runBuildCheck(stackId, { parentDir, dest }) {
  let buildOk = true;
  for (const step of verifySteps(stackId)) {
    console.log('\n▶ ' + c.bold(t('initVerifyStep', step.label)) + c.dim(`  · ${step.command} ${step.args.join(' ')}`));
    const r = await runInitStep({ ...step, cwd: 'project' }, { parentDir, projectDir: dest });
    if (r.code !== 0) { buildOk = false; console.log(c.yellow('  ' + t('initVerifyFail', step.label, r.code))); break; }
  }
  console.log(buildOk ? c.green('\n✓ ' + t('initVerifyDone')) : c.red('\n✗ ' + t('initVerifyFailed')));
  return buildOk;
}

// 6-11) Crear, re-moldear a la arquitectura, equipar y verificar el proyecto.
async function createProject({ stackId, decision, steps, targetName, doVerify, dest, projectName }) {
  const dirs = { parentDir: dirname(dest), dest };
  await runScaffold(steps, dirs);
  // 7) Re-moldear a la arquitectura + documentar la decisión.
  const reshaped = await reshapeProject(dest, decision);
  // 8) Equipar (mismo motor que `apply`): stack + principios globales + skills propias de la arquitectura.
  const extraSkills = architectureSkills(stackId, decision.architecture.id);
  const equipped = await equipCreatedProject(dest, { targetName, methodMode: 'lite', extraSkills, architecture: { name: archText(decision.architecture.label, decision.contentLang) }, specLang: decision.contentLang });
  console.log('\n' + c.green('✓ ' + t('initCreated', dest)));
  console.log(c.dim('  ' + t('initFolders', reshaped.folders.join(', '))));
  console.log(c.green('✓ ' + t('initEquipped', equipped.skills.length, equipped.mcps.length, equipped.methods.length, targetName)));
  console.log(c.dim('  ' + t('initEquipNote')));
  // 9) Verificación determinista (sin tokens): ¿está todo en su sitio y respeta las fronteras?
  const verifiedOk = printVerification(await verifyProject(dest, { expectFolders: reshaped.folders, target: targetName }));
  const buildOk = doVerify ? await runBuildCheck(stackId, dirs) : true;
  // 11) Cierre. Una verificación o un build fallidos se reflejan en el código de salida (CI).
  if (!verifiedOk || !buildOk) process.exitCode = 1;
  console.log('\n' + (verifiedOk ? c.green('✓ ' + t('initCreatedOk')) : c.yellow('! ' + t('initCreatedWarn'))));
  console.log(c.dim('  ' + t('initNextStep', projectName) + '\n'));
}

// Crea un proyecto desde cero con decisión arquitectónica guiada y luego lo equipa con Chalc.
export async function runInit() {
  console.log('\n' + c.bold('⚙️  chalc init') + (dryRun ? c.dim('  (dry-run)') : '') + '\n');
  const prompter = interactive ? makePrompter() : null;
  const stackId = await askStack(prompter);
  const projectName = await askProjectName(prompter, stackId);
  const baseDir = await askBaseDir(prompter);
  // Idioma del CONTENIDO del proyecto (docs, README de carpetas, bloque del asistente): `--lang` o, sin él,
  // el de la interfaz como hasta ahora (R36, spec 016). Con `--lang` la consola también lo usa (R39).
  const code = contentLang(flags.lang);
  const chosen = await decideArchitecture(prompter, stackId, await askProposal(prompter, projectName));
  const decision = { ...chosen, contentLang: code, mandatoryPrinciples: mandatoryPrinciples(code) };
  const targetName = await askInitTarget(prompter);
  const dest = resolve(baseDir, projectName);
  setTokenLogProject(dest);   // el gasto de IA del init (análisis de arquitectura) queda en el proyecto creado
  const steps = scaffoldSteps(stackId, decision.architecture.id, projectName);
  const doVerify = !!flags.verify;
  await printInitSummary({ dest, decision, steps, stackId, targetName, doVerify });
  if (prompter) {
    const ok = await prompter.yesno(dryRun ? t('initConfirmDry') : t('initConfirmCreate'), true);
    prompter.close();
    if (!ok) { console.log(c.dim('\n' + t('cancelled') + '\n')); return; }
  }
  if (dryRun) { printInitDryRun(steps, targetName, doVerify); return; }
  if (existsSync(dest)) throw new Error(t('initExists', dest));
  if (!interactive && !allowExternalExec) throw new Error(t('initNeedsExec'));
  await createProject({ stackId, decision, steps, targetName, doVerify, dest, projectName });
}

// ---------- comando: chalc verify / check (verifica un proyecto existente) ----------
// Determinista, sin tokens: completitud estructural + linter de fronteras. Si falla, sale con código 1
// (`--strict` se acepta por compatibilidad; ya es el comportamiento por defecto).
export async function runVerify() {
  const proj = resolve(cleanPath(String(positional[1] || flags.path || '.')));
  console.log('\n' + c.bold('⚙️  ' + t('checkHdr')) + c.dim('  ·  ' + proj) + '\n');
  if (!existsSync(proj)) { console.log(c.red('✗ ' + t('pathMissing', proj))); exitCommand(1); }
  const verification = await verifyProject(proj);
  const ok = printVerification(verification);
  const findings = verification.checks.filter((ch) => !ch.ok).length + verification.violations.length;
  console.log('\n' + (ok ? c.green('✓ ' + t('checkOk')) : c.yellow('! ' + t('checkFindings', findings))) + '\n');
  if (!ok) process.exitCode = 1;   // con o sin --strict: una verificación fallida no sale en verde
}
