// Comandos `chalc init` (proyecto desde cero con decisión arquitectónica guiada) y
// `chalc verify` (verificación determinista), con sus helpers de scaffold/verificación.

import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { t, lang } from '../i18n.mjs';
import { assertSafeId } from '../ids.mjs';
import { configForTask, isConfigured, loadConfig } from '../ai.mjs';
import { readDocument } from '../docread.mjs';
import { analyzeProjectProposal, architectureSkills, archText, buildArchitectureDecision, dartPackageName, getStack, listStacks, localizeComplexity, localizeType, MANDATORY_DESIGN_PRINCIPLES, resolveScaffoldTool, scaffoldSteps, slugifyProjectName, suggestArchitectures, verifySteps } from '../init.mjs';
import { reshapeProject } from '../init-scaffold.mjs';
import { analyzeArchitectureWithAi } from '../initai.mjs';
import { setTokenLogProject } from '../tokenlog.mjs';
import { verifyProject } from '../verify.mjs';
import { procOpts } from '../proc.mjs';
import { c, cleanPath, dryRun, flags, allowExternalExec, interactive, positional } from './context.mjs';
import { loadTargets } from './catalogstore.mjs';
import { makePrompter } from './prompter.mjs';
import { equipCreatedProject } from './equip.mjs';
import { printAiLine } from './ai.mjs';

// Corre un paso del scaffolder/verify con salida visible. cwd: 'project' = dentro de <dest>; si no, en el padre.
export function runInitStep(step, { parentDir, projectDir }) {
  return new Promise((res) => {
    const cwd = step.cwd === 'project' ? projectDir : parentDir;
    // shell:true en Windows: npx/npm/flutter son shims .cmd/.bat y spawn no los resuelve sin shell (ENOENT).
    const child = spawn(step.command, step.args, procOpts({ cwd, stdio: 'inherit', env: { ...process.env, NG_CLI_ANALYTICS: 'false' } }));
    child.on('error', (e) => res({ code: -1, error: e }));
    child.on('exit', (code) => res({ code: code ?? -1 }));
  });
}

// Lee la versión del Flutter instalado en la máquina (la que usará `flutter create`). null si no está en PATH.
export function detectFlutterVersion() {
  return new Promise((res) => {
    try {
      let out = '';
      const child = spawn('flutter', ['--version'], procOpts({ stdio: ['ignore', 'pipe', 'ignore'] }));
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
// Crea un proyecto desde cero con decisión arquitectónica guiada y luego lo equipa con Chalc.
export async function runInit() {
  console.log('\n' + c.bold('⚙️  chalc init') + (dryRun ? c.dim('  (dry-run)') : '') + '\n');
  const prompter = interactive ? makePrompter() : null;
  const stacks = listStacks();

  // 1) Stack (lenguaje/framework).
  let stackId = String(positional[1] || flags.stack || '').trim().toLowerCase();
  if (prompter && !stackId) {
    // Buscador automático cuando la lista crezca (hacia "cualquier lenguaje"); con pocos, selector simple.
    stackId = stacks[await prompter.select(t('initStackQ'), stacks.map((s) => ({ label: s.label })), 0, { search: stacks.length > 6 })].id;
  }
  if (!stackId) stackId = 'angular';
  if (!getStack(stackId)) {
    if (prompter) prompter.close();
    throw new Error(t('initStackUnsupported', stackId, stacks.map((s) => s.id).join(', ')));
  }

  // 2) Nombre del proyecto.
  let projectName = slugifyProjectName(flags.name || positional[2] || '');
  if (prompter && (!projectName || projectName === 'chalc-app')) {
    projectName = slugifyProjectName(await prompter.text(t('initNameQ')));
  }
  if (!projectName) projectName = 'chalc-app';
  // Flutter/Dart exige nombre de paquete en snake_case (rechaza guiones): se aplica al nombre y a la carpeta.
  if (stackId === 'flutter') projectName = dartPackageName(projectName);

  // 2b) Ubicación: carpeta padre donde se creará <projectName>. Default = directorio actual.
  let baseDir = String(flags.dir || '').trim() ? resolve(cleanPath(String(flags.dir))) : process.cwd();
  if (prompter) {
    const ans = (await prompter.text(t('initDirQ', baseDir))).trim();
    if (ans) baseDir = resolve(cleanPath(ans));
  }

  // 3) Propuesta: texto o documento (Word/PDF/MD/TXT) → reusa la ingesta de spec-ia.
  let proposal = String(flags.description || '').trim();
  if (flags.doc) proposal = await readDocument(resolve(cleanPath(String(flags.doc))));
  if (prompter && !proposal) {
    const sources = [
      { label: t('initCtxText'), value: 'text' },
      { label: t('initCtxFile'), value: 'file' }
    ];
    const source = sources[await prompter.select(t('initContextQ'), sources, 0)].value;
    if (source === 'file') proposal = await readDocument(resolve(cleanPath(await prompter.text(t('initFileQ')))));
    else proposal = await prompter.text(t('initProposalQ'));
  }
  if (!proposal) proposal = projectName;

  // 4) Arquitectura: chalc sugiere (calibrada), el usuario decide.
  const analysis = analyzeProjectProposal(proposal);
  const suggestions = suggestArchitectures(stackId, analysis);
  let recommendedIndex = Math.max(0, suggestions.findIndex((item) => item.recommended));
  let architectureId = String(flags.architecture || '').trim();

  // 4b) IA por defecto (es la razón de ser de init): analiza la propuesta, PREGUNTA sus dudas al usuario
  // y re-analiza con las respuestas. Usa modelo económico + CCR. --no-ai la desactiva.
  let aiHint = null;
  const clarificationsQA = [];
  if (!architectureId && flags.ai !== false) {
    const cfg = await loadConfig();
    if (!isConfigured(cfg)) {
      console.log(c.dim('  ' + t('initAiNotConf')));
    } else {
      printAiLine(configForTask(cfg, 'qa'));   // init usa el modelo económico (perfil 'qa')
      console.log(c.dim('  ' + t('initAiAnalyzing')));
      try {
        aiHint = await analyzeArchitectureWithAi({ cfg, stackId, proposal, principles: MANDATORY_DESIGN_PRINCIPLES, language: lang === 'en' ? 'English' : 'español' });

        // Las dudas del LLM se le PREGUNTAN al usuario (no se dejan pasar) y se re-analiza con las respuestas.
        if (prompter && aiHint.clarifications?.length) {
          console.log('\n  ' + c.bold(t('initAiClarifyHdr')) + c.dim('  ' + t('initAiClarifyHint')));
          for (const q of aiHint.clarifications) {
            const a = (await prompter.text(`  ${q}`)).trim();
            if (a) clarificationsQA.push({ q, a });
          }
          if (clarificationsQA.length) {
            proposal += '\n\n' + (lang === 'en' ? 'User clarifications' : 'Aclaraciones del usuario') + ':\n' + clarificationsQA.map((x) => `- ${x.q} → ${x.a}`).join('\n');
            console.log(c.dim('  ' + t('initAiReanalyzing')));
            aiHint = await analyzeArchitectureWithAi({ cfg, stackId, proposal, principles: MANDATORY_DESIGN_PRINCIPLES, language: lang === 'en' ? 'English' : 'español' });
          }
        } else if (aiHint.clarifications?.length) {
          console.log(c.dim('  ' + t('initAiPending', aiHint.clarifications.join(' · '))));
        }

        const idx = suggestions.findIndex((s) => s.id === aiHint.architectureId);
        if (idx >= 0) recommendedIndex = idx;
        const recLabel = archText(suggestions.find((s) => s.id === aiHint.architectureId)?.label) || aiHint.architectureId;
        console.log('\n' + c.bold(t('initAiSuggestion')) + c.dim(aiHint.source === 'fallback' ? '  ' + t('initAiFallback') : ''));
        console.log(`  ${t('initAiArch')}: ${c.bold(recLabel)}`);
        if (aiHint.reasoning) console.log(`  ${t('initAiWhy', aiHint.reasoning)}`);
        if (aiHint.ccr) console.log(c.dim('  ' + t('initAiCcr', aiHint.ccr.entries, aiHint.ccr.charsSaved)));
        console.log(c.dim('  ' + t('initHumanDecision')));
      } catch (e) { console.log(c.yellow('  ! ' + t('initAiFailed', e.message))); }
    }
  }

  if (prompter && !architectureId) {
    console.log('\n' + c.bold(t('initReadingHdr')));
    console.log(`  ${t('initTypeL')}: ${localizeType(analysis.typeKey)}`);
    console.log(`  ${t('initCxL')}: ${localizeComplexity(analysis.complexity)}`);
    console.log(`  ${t('initSignalsL')}: ${analysis.signals.length ? analysis.signals.join(', ') : t('initNoSignals')}`);
    if (analysis.missing.length) console.log(c.dim('  ' + t('initPending', analysis.missing.join(', '))));
    console.log(c.dim('\n  ' + t('initPrinciplesAlways') + '\n'));
    const idx = await prompter.select(t('initArchQ'), suggestions.map((item) => ({
      label: `${archText(item.label)}${item.recommended ? ' (' + t('initRecommended') + ')' : ''}${aiHint && aiHint.architectureId === item.id ? ' ★ IA' : ''} — ${archText(item.fit)}`
    })), recommendedIndex);
    architectureId = suggestions[idx].id;
  }
  if (!architectureId) architectureId = suggestions[recommendedIndex].id;
  const decision = buildArchitectureDecision({ stack: stackId, proposal, architectureId: architectureId || suggestions[recommendedIndex].id, clarifications: clarificationsQA });

  // 5) Target (asistente de IA).
  let targetName = String(flags.target || 'claude');
  const targetOptions = (await loadTargets()).map((tgt) => ({ label: tgt.label, value: tgt.id }));
  if (prompter) {
    const di = Math.max(0, targetOptions.findIndex((o) => o.value === targetName));
    targetName = targetOptions[await prompter.select(t('initAssistantQ'), targetOptions, di)].value;
  }
  targetName = assertSafeId(targetName, 'target');

  const dest = resolve(baseDir, projectName);
  const parentDir = dirname(dest);
  setTokenLogProject(dest);   // el gasto de IA del init (análisis de arquitectura) queda en el proyecto creado
  const steps = scaffoldSteps(stackId, decision.architecture.id, projectName);
  const doVerify = !!flags.verify;

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
  console.log(`  ${t('initSumPrinciples')}: ${decision.mandatoryPrinciples.slice(0, 4).join(', ')} ${t('initSumAlways')}`);
  console.log(`  ${t('initSumTarget')}: ${targetName}${doVerify ? c.dim('  · ' + t('initWithVerify')) : ''}`);
  if (prompter) {
    const ok = await prompter.yesno(dryRun ? t('initConfirmDry') : t('initConfirmCreate'), true);
    prompter.close();
    if (!ok) { console.log(c.dim('\n' + t('cancelled') + '\n')); return; }
  }

  if (dryRun) {
    console.log(c.dim('\n' + t('initDryHdr')));
    steps.forEach((s) => console.log(c.dim(`  ▶ ${s.command} ${s.args.join(' ')}`)));
    console.log(c.dim(`  ▶ ${t('initDryFolders')}`));
    console.log(c.dim(`  ▶ ${t('initDryEquip', targetName, doVerify)}\n`));
    return;
  }

  if (existsSync(dest)) throw new Error(t('initExists', dest));
  if (!interactive && !allowExternalExec) throw new Error(t('initNeedsExec'));

  // 6) Scaffolder oficial (ng new / nest new / dotnet new). Aseguramos la carpeta padre (cwd del scaffolder).
  // Solo si no existe: en Windows, mkdir sobre la raíz del disco (p. ej. D:\, padre de D:\prueba) lanza EPERM.
  if (!existsSync(parentDir)) await mkdir(parentDir, { recursive: true });
  if (steps.some((s) => s.cwd === 'project')) await mkdir(dest, { recursive: true });
  for (const step of steps) {
    console.log('\n▶ ' + c.bold(step.label) + c.dim(`  · ${step.command} ${step.args.join(' ')}`));
    const r = await runInitStep(step, { parentDir, projectDir: dest });
    if (r.code !== 0) throw new Error(t('initScaffoldFail', step.label, r.error?.code || r.error?.message || t('scaffoldExitCode', r.code), step.command));
  }
  if (!existsSync(dest)) throw new Error(t('initScaffoldNoDir', dest));

  // 7) Re-moldear a la arquitectura + documentar la decisión.
  const reshaped = await reshapeProject(dest, decision);

  // 8) Equipar (mismo motor que `apply`): stack + principios globales + skills propias de la arquitectura.
  const extraSkills = architectureSkills(stackId, decision.architecture.id);
  const equipped = await equipCreatedProject(dest, { targetName, methodMode: 'lite', extraSkills, architecture: { name: archText(decision.architecture.label) } });

  console.log('\n' + c.green('✓ ' + t('initCreated', dest)));
  console.log(c.dim('  ' + t('initFolders', reshaped.folders.join(', '))));
  console.log(c.green('✓ ' + t('initEquipped', equipped.skills.length, equipped.mcps.length, equipped.methods.length, targetName)));
  console.log(c.dim('  ' + t('initEquipNote')));

  // 9) Verificación determinista (sin tokens): ¿está todo en su sitio y respeta las fronteras?
  const verification = await verifyProject(dest, { expectFolders: reshaped.folders, target: targetName });
  const verifiedOk = printVerification(verification);

  // 10) Build check opcional (--verify).
  if (doVerify) {
    for (const step of verifySteps(stackId)) {
      console.log('\n▶ ' + c.bold(t('initVerifyStep', step.label)) + c.dim(`  · ${step.command} ${step.args.join(' ')}`));
      const r = await runInitStep({ ...step, cwd: 'project' }, { parentDir, projectDir: dest });
      if (r.code !== 0) { console.log(c.yellow('  ' + t('initVerifyFail', step.label, r.code))); break; }
    }
    console.log(c.green('\n✓ ' + t('initVerifyDone')));
  }

  // 11) Cierre.
  console.log('\n' + (verifiedOk ? c.green('✓ ' + t('initCreatedOk')) : c.yellow('! ' + t('initCreatedWarn'))));
  console.log(c.dim('  ' + t('initNextStep', projectName) + '\n'));
}

// ---------- comando: chalc verify / check (verifica un proyecto existente) ----------
// Determinista, sin tokens: completitud estructural + linter de fronteras. `--strict` sale con código 1 (CI).
export async function runVerify() {
  const proj = resolve(cleanPath(String(positional[1] || flags.path || '.')));
  console.log('\n' + c.bold('⚙️  ' + t('checkHdr')) + c.dim('  ·  ' + proj) + '\n');
  if (!existsSync(proj)) { console.log(c.red('✗ ' + t('pathMissing', proj))); process.exit(1); }
  const verification = await verifyProject(proj);
  const ok = printVerification(verification);
  const findings = verification.checks.filter((ch) => !ch.ok).length + verification.violations.length;
  console.log('\n' + (ok ? c.green('✓ ' + t('checkOk')) : c.yellow('! ' + t('checkFindings', findings))) + '\n');
  if (!ok && flags.strict) process.exit(1);
}
