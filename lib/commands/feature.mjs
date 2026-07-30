// Comando `chalc feature` (orquestador full-stack: HU → contrato + spec back + spec front) y su hand-off.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { t, lang } from '../i18n.mjs';
import { configForTask, isConfigured } from '../ai.mjs';
import { orchestrateFeature, orchestrateFeatures } from '../featureorch.mjs';
import { contractFingerprint, contractStamp, stampFiles, sharedNumber, readContractLock, writeContractLock } from '../specfolder.mjs';
import { safePull, createFeatureBranch } from '../gitprep.mjs';
import { workspaceGate, planWorkspace, createWorkspace, writeHandoff, rememberWorkspaceDir, recallWorkspaceDir, workspaceBaseDir } from '../workspace.mjs';
import { findDuplicateRoutes } from '../contractlint.mjs';
import { openAllScript, launchTerminals } from '../terminals.mjs';
import { appendAiTrace, makeAiTrace } from '../aitrace.mjs';
import { setTokenLogProject } from '../tokenlog.mjs';
import { c, cleanPath, disp, dryRun, flags, interactive, positional } from './context.mjs';
import { askExistingPath, makePrompter, startSpinner, stopSpinner } from './prompter.mjs';
import { equipForSpec } from './equip.mjs';
import { detectStackLabel, loadSpecScaffold, writeSideSpec } from './spec.mjs';
import { configureAi, printAiLine, resolveAiTaskConfig } from './ai.mjs';
import { acquireUserStory, langName } from './specgen.mjs';

// Hand-off ÚNICO para el orquestador full-stack: un solo mensaje que coordina los repos (2 o 3, si hay
// móvil) alrededor del contrato. No es un mensaje por repo: es la instrucción del orquestador. Sigue el
// idioma del spec. Los pasos se numeran al final para que el del móvil (opcional) no rompa la secuencia.
export function featureHandoff({ backPath, backRel, frontPath, frontRel, mobilePath = '', mobileRel = '', branch, backBranchCreated, frontBranchCreated, mobileBranchCreated = false, specLang }) {
  const code = String(specLang).toLowerCase();
  const en = !(/espa|spanish|castell/.test(code) || code === 'es' || (!specLang && lang === 'es'));
  const hasMobile = !!mobilePath;
  const created = [backBranchCreated, frontBranchCreated, ...(hasMobile ? [mobileBranchCreated] : [])];
  const all = created.every(Boolean);
  const none = created.every((x) => !x);
  const branchNote = en
    ? (all ? `chalc already created it in every repo` : none ? `create it in each repo: git checkout -b ${branch}` : `chalc created it where the tree was clean; create it where missing: git checkout -b ${branch}`)
    : (all ? `chalc ya la creó en todos los repos` : none ? `créala en cada repo: git checkout -b ${branch}` : `chalc la creó donde el árbol estaba limpio; donde falte, créala: git checkout -b ${branch}`);
  const count = en ? (hasMobile ? 'THREE' : 'TWO') : (hasMobile ? 'TRES' : 'DOS');
  if (en) {
    const repos = [
      `- BACKEND (exposes the API):  \`${backPath}\`  → spec: \`${backRel}/\``,
      `- FRONTEND (consumes the API): \`${frontPath}\`  → spec: \`${frontRel}/\``,
      ...(hasMobile ? [`- MOBILE (consumes the API): \`${mobilePath}\`  → spec: \`${mobileRel}/\``] : [])
    ];
    const steps = [
      `Start with the BACKEND (it owns the contract). Read \`${backRel}/contracts/api.md\`, \`specs/constitution.md\` and \`${backRel}/spec.md\` (R1, R2… in EARS). Follow \`${backRel}/plan.md\` and execute \`${backRel}/tasks.md\` ONE task at a time. Implement EXACTLY the contract's endpoints.`,
      `Then the FRONTEND. Same with \`${frontRel}/\`, but CONSUMING the contract (same routes/shapes); don't reimplement backend logic.`,
      ...(hasMobile ? [`Then the MOBILE app. Same with \`${mobileRel}/\`, consuming the SAME contract (same routes/shapes); don't reimplement backend logic nor duplicate the frontend's.`] : []),
      `R# are SHARED: the same R# is satisfied on ${hasMobile ? 'backend, frontend and/or mobile' : 'backend and/or frontend'} — keep cross-repo traceability.`,
      `Per task, strict TDD: failing test (Red) → minimum code (Green) → refactor. Never code without a failing test first.`,
      `Before each task, state which R# and which repo; when done, stop and wait for my OK.`,
      `Branch \`${branch}\` in each repo (${branchNote}).`,
      `If something is [NEEDS CLARIFICATION] in the contract or a spec, ask me first. The spec is the source of truth: if scope changes, update spec and contract first.`
    ];
    return [
      `You are the ORCHESTRATOR of this full-stack feature. You coordinate ${count} repos around a single API contract, with Spec-Driven Development and strict TDD.`,
      ``,
      `📜 Contract (source of truth, identical in every spec): \`contracts/api.md\`. Every endpoint, request/response and error comes from there — invent nothing outside it.`,
      ``,
      `Repos:`,
      ...repos,
      ``,
      `How to orchestrate:`,
      ...steps.map((s, i) => `${i + 1}. ${s}`)
    ].join('\n');
  }
  const repos = [
    `- BACKEND (expone la API):  \`${backPath}\`  → spec: \`${backRel}/\``,
    `- FRONTEND (consume la API): \`${frontPath}\`  → spec: \`${frontRel}/\``,
    ...(hasMobile ? [`- MÓVIL (consume la API): \`${mobilePath}\`  → spec: \`${mobileRel}/\``] : [])
  ];
  const steps = [
    `Empieza por el BACKEND (es dueño del contrato). Lee \`${backRel}/contracts/api.md\`, \`specs/constitution.md\` y \`${backRel}/spec.md\` (R1, R2… en EARS). Sigue \`${backRel}/plan.md\` y ejecuta \`${backRel}/tasks.md\` UNA tarea a la vez. Implementa EXACTAMENTE los endpoints del contrato.`,
    `Sigue con el FRONTEND. Igual con \`${frontRel}/\`, pero CONSUMIENDO el contrato (mismas rutas/shapes); no reimplementes la lógica del back.`,
    ...(hasMobile ? [`Luego el MÓVIL. Igual con \`${mobileRel}/\`, consumiendo el MISMO contrato (mismas rutas/shapes); no reimplementes la lógica del back ni dupliques la del front.`] : []),
    `Los R# son COMPARTIDOS: el mismo R# se cumple en ${hasMobile ? 'back, front y/o móvil' : 'back y/o front'} — mantén la trazabilidad cruzada.`,
    `Por tarea, TDD estricto: test que falla (Red) → mínimo código (Green) → refactor. Nunca código sin un test que falle primero.`,
    `Antes de cada tarea di qué R# y en qué repo; al terminar, párate y espera mi OK.`,
    `Rama \`${branch}\` en cada repo (${branchNote}).`,
    `Si algo está [NEEDS CLARIFICATION] en el contrato o una spec, pregúntame antes. La spec es la fuente de verdad: si cambia el alcance, actualiza spec y contrato primero.`
  ];
  return [
    `Eres el ORQUESTADOR de esta feature full-stack. Coordinas ${count} repos alrededor de un único contrato de API, con Spec-Driven Development y TDD estricto.`,
    ``,
    `📜 Contrato (fuente de verdad, idéntico en todas las specs): \`contracts/api.md\`. Todo endpoint, request/response y error sale de ahí — no inventes nada fuera del contrato.`,
    ``,
    `Repos:`,
    ...repos,
    ``,
    `Cómo orquestar:`,
    ...steps.map((s, i) => `${i + 1}. ${s}`)
  ].join('\n');
}

// Hand-off del WORKSPACE (spec 005, R11): el mismo orquestador, pero la sesión se abre en la
// raíz del workspace y los lados son subcarpetas — todo va en rutas RELATIVAS (back/, front/,
// movil/). Reusa featureHandoff (DRY) y anexa la instrucción de limpieza de worktrees.
export function featureWorkspaceHandoff({ id, branch, specLang, hasMobile = false }) {
  const code = String(specLang).toLowerCase();
  const en = !(/espa|spanish|castell/.test(code) || code === 'es' || (!specLang && lang === 'es'));
  const specRel = (side) => `${side}/specs/${id}`;
  const body = featureHandoff({
    backPath: 'back', backRel: specRel('back'),
    frontPath: 'front', frontRel: specRel('front'),
    mobilePath: hasMobile ? 'movil' : '', mobileRel: hasMobile ? specRel('movil') : '',
    branch, backBranchCreated: true, frontBranchCreated: true, mobileBranchCreated: hasMobile, specLang
  });
  const cleanup = en
    ? `🧹 Cleanup: do not move this workspace folder (each worktree stores the absolute path to its repo). When a side's PR merges, remove its worktree FROM the original repo: \`git worktree remove <path>\` — chalc never does it for you.`
    : `🧹 Limpieza: no muevas esta carpeta de workspace (cada worktree guarda la ruta absoluta hacia su repo). Cuando el PR de un lado se mergee, quita su worktree DESDE el repo original: \`git worktree remove <ruta>\` — chalc nunca lo hace por ti.`;
  return body + '\n\n' + cleanup;
}

// Lee el target/modo SDD equipados de un repo (.chalc.json); defaults conservadores. Compartidos
// por el camino normal y el modo worktree.
function readTarget(p) { try { return JSON.parse(readFileSync(join(p, '.chalc.json'), 'utf8')).target || 'claude'; } catch { return 'claude'; } }
function readMode(p) { try { const m = (JSON.parse(readFileSync(join(p, '.chalc.json'), 'utf8')).methods || []).find((x) => String(x).startsWith('sdd')); return m && String(m).includes(':') ? String(m).split(':')[1] : 'lite'; } catch { return 'lite'; } }

// Idioma del SPEC (el del proyecto), por flag o preguntando. Compartido por ambos caminos.
async function askSpecLang(prompter) {
  let specLang = flags.lang ? langName(String(flags.lang)) : null;
  if (prompter && !specLang) {
    const optsL = [{ label: 'Español', value: 'español' }, { label: 'English', value: 'English' }, { label: t('otherLang'), value: '__other' }];
    const idx = await prompter.select(t('specLangQ'), optsL.map((o) => ({ label: o.label })), lang === 'en' ? 1 : 0);
    specLang = optsL[idx].value;
    if (specLang === '__other') specLang = (await prompter.text(t('otherLangQ') + ':')).trim() || langName(lang);
  }
  return specLang || langName(lang);
}

// Modo SDD: --full/--mode mandan; si no, lee el modo ACTUAL del back y pregunta si cambiarlo.
async function askSddMode(prompter, backPath) {
  let mode = flags.full ? 'full' : String(flags.mode || '').toLowerCase();
  if (mode !== 'lite' && mode !== 'full') {
    const current = readMode(backPath);                          // lo que ya tiene equipado el back (default lite)
    if (prompter) {
      const other = current === 'full' ? 'lite' : 'full';
      mode = (await prompter.yesno(t('sddModeCurrentQ', current, other), false)) ? other : current;
    } else { mode = current; }
  }
  return mode;
}

// ---------- comando: chalc feature (orquestador full-stack: HU → contrato + spec back + spec front) ----------
export async function runFeature(opts = {}) {
  console.log('\n' + c.bold('⚙️  ' + t('featHdr')) + (dryRun ? c.dim('  (dry-run)') : '') + '\n');
  const prompter = interactive ? makePrompter() : null;
  let cfg = await resolveAiTaskConfig('spec');
  if (!isConfigured(cfg)) {
    if (!prompter) { console.error(c.red('✗ ' + t('aiNotConfigured'))); process.exit(1); }
    cfg = configForTask(await configureAi(prompter), 'spec');
  }
  printAiLine(cfg);   // muestra qué proveedor/modelo se usará

  // 1) Rutas: front y back obligatorias; móvil OPCIONAL (spec 003). Vacías o inexistentes: re-pregunta (no deja pasar).
  let frontPath = positional[1] ? resolve(cleanPath(positional[1])) : (prompter ? await askExistingPath(prompter, t('featFrontQ')) : process.cwd());
  let backPath = flags.back ? resolve(cleanPath(String(flags.back))) : '';
  if (!backPath && prompter && (opts.assumeBack || await prompter.yesno(t('featHasBackQ'), true))) {
    backPath = await askExistingPath(prompter, t('featBackPathQ'));
  }
  if (!backPath) { if (prompter) prompter.close(); console.error(c.yellow('! ' + t('featNoBack'))); process.exit(1); }
  // Móvil: por flag --movil/--mobile (R2) o preguntando (R1). Es otro consumidor del mismo contrato.
  const mobileFlag = flags.movil || flags.mobile;
  let mobilePath = mobileFlag ? resolve(cleanPath(String(mobileFlag))) : '';
  if (!mobilePath && prompter && await prompter.yesno(t('featHasMobileQ'), false)) {
    mobilePath = await askExistingPath(prompter, t('featMobilePathQ'));
  }
  for (const p of [frontPath, backPath, ...(mobilePath ? [mobilePath] : [])]) {
    if (!existsSync(p)) { if (prompter) prompter.close(); console.error(c.red('✗ ' + t('pathMissing', p))); process.exit(1); }
  }
  // Los lados de la feature: clave interna + ruta. La etiqueta visible del móvil va por t() (paridad es/en).
  const sides = [['front', frontPath], ['back', backPath], ...(mobilePath ? [['movil', mobilePath]] : [])];
  const sideDisp = (name) => (name === 'movil' ? t('sideMobile') : name);
  setTokenLogProject(frontPath);   // el histórico de consumo del feature vive en el repo front (ver spec 002, fuera de alcance)
  // Identifica los stacks YA, para que el usuario confirme que reconoció bien cada repo antes de seguir (R3).
  const frontStack = await detectStackLabel(frontPath);
  const backStack = await detectStackLabel(backPath);
  const mobileStack = mobilePath ? await detectStackLabel(mobilePath) : '';
  const unknown = () => c.yellow(t('featUnknownStack'));
  console.log('  ' + c.green('✓') + ' ' + t('featDetect', frontStack || unknown(), backStack || unknown())
    + (mobilePath ? '  ·  ' + t('featDetectMobile', mobileStack || unknown()) : ''));
  if (!frontStack || !backStack || (mobilePath && !mobileStack)) console.log(c.dim('  ' + t('featUnknownHint')));
  // Modo de trabajo (spec 005, R1): repo sin rama (default, flujo actual) / repo con rama /
  // worktrees aislados. --worktree y --branch/--no-branch lo fijan sin preguntar (R1, R2).
  let workMode = flags.worktree ? 'worktree' : (flags.branch != null ? (flags.branch ? 'branch' : 'repo') : '');
  if (!workMode && prompter) {
    const labels = [t('featModeRepo'), t('featModeBranch'), t('featModeWorktree')];
    workMode = ['repo', 'branch', 'worktree'][await prompter.select(t('featModeQ'), labels.map((label) => ({ label })), 0)];
  }
  if (!workMode) workMode = 'repo';
  if (workMode === 'worktree') {
    return runFeatureWorktree({ cfg, prompter, backPath, frontPath, mobilePath, backStack, frontStack, mobileStack });
  }
  const wantBranch = workMode === 'branch';

  // 2) Idioma del spec + modo (del back si está equipado).
  const specLang = await askSpecLang(prompter);
  const mode = await askSddMode(prompter, backPath);

  // 3) HU.
  const userStory = await acquireUserStory(prompter);
  if (!userStory.trim()) { if (prompter) prompter.close(); console.error(c.red('✗ ' + t('docEmpty'))); process.exit(1); }

  // 4) Estado Git PREVIO + readiness. El git va PRIMERO: equipar escribe archivos y ensuciaría el árbol,
  // así que capturamos aquí el estado real (limpio/sucio) para decidir luego si es seguro crear la rama.
  if (prompter) prompter.close();
  console.log('\n' + c.bold('🔎 ' + t('featReadiness')));
  const gitState = {};
  for (const [name, p] of sides) {
    const pull = await safePull(p);
    gitState[name] = pull;
    const mark = pull.ok ? c.green('✓') : c.yellow('!');
    console.log('  ' + mark + ' ' + t('featGit', sideDisp(name), t('gitReason_' + pull.reason.replace(/-/g, '_'))));
  }
  for (const [name, p] of sides) {
    const skills = await equipForSpec(p, mode, readTarget(p), specLang);
    console.log('  ' + c.green('✓') + ' ' + t('featReadyRepo', sideDisp(name), skills.length));
  }

  // 6) Contexto del back para el contrato (architecture.md si existe). Los stacks ya se detectaron arriba.
  const backContext = existsSync(join(backPath, 'docs', 'architecture.md')) ? await readFile(join(backPath, 'docs', 'architecture.md'), 'utf8') : '';

  // 7) Orquestar: contrato → spec back → spec front → spec móvil (si hay).
  const backScaffold = await loadSpecScaffold(backPath, mode, specLang);
  const frontScaffold = await loadSpecScaffold(frontPath, mode, specLang);
  const mobileScaffold = mobilePath ? await loadSpecScaffold(mobilePath, mode, specLang) : null;
  const spin = startSpinner(t('featOrchestrating', !!mobilePath));
  let result;
  try {
    result = await orchestrateFeature({
      cfg, userStory, language: specLang, mode, backContext,
      back: { stack: backStack, templates: backScaffold.templates, constitution: backScaffold.constitution },
      front: { stack: frontStack, templates: frontScaffold.templates, constitution: frontScaffold.constitution },
      mobile: mobileScaffold ? { stack: mobileStack, templates: mobileScaffold.templates, constitution: mobileScaffold.constitution } : null
    });
  } finally { stopSpinner(spin); }

  // 8) Escribir: back (spec + contrato) y front (spec + copia del contrato para consumirlo).
  // Un mismo NNN para ambos repos (IDs alineados front/back) en features nuevas; si un repo ya
  // tenía la carpeta del slug, writeSideSpec la reúsa. El contrato se estampa en cada spec y se
  // guarda un lock: así spec/plan/tasks NUNCA quedan desincronizados del contrato que los originó.
  const slug = (result.front.feature || result.back.feature || 'feature').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'feature';
  const fp = contractFingerprint(result.contract);
  const generatedAt = new Date().toISOString();
  const stamp = contractStamp(fp, generatedAt);
  const sharedNum = await sharedNumber(sides.map(([, p]) => join(p, 'specs')));
  const backOut = await writeSideSpec(backPath, slug, stampFiles(result.back.files, stamp), sharedNum);
  const frontOut = await writeSideSpec(frontPath, slug, stampFiles(result.front.files, stamp), sharedNum);
  const mobileOut = mobilePath ? await writeSideSpec(mobilePath, slug, stampFiles(result.mobile.files, stamp), sharedNum) : null;
  const outs = [['back', backOut], ['front', frontOut], ...(mobileOut ? [['movil', mobileOut]] : [])];
  for (const [role, out] of outs) {
    if (out.reused) console.log('  ' + c.yellow('!') + ' ' + t('featReusingFolder', sideDisp(role), out.id));
    const prev = await readContractLock(out.dest);
    if (prev && prev.contractHash !== fp) console.log('  ' + c.yellow('!') + ' ' + t('featContractRefreshed', sideDisp(role)));
    await mkdir(join(out.dest, 'contracts'), { recursive: true });
    await writeFile(join(out.dest, 'contracts', 'api.md'), result.contract.replace(/\s*$/, '') + '\n');
    await writeContractLock(out.dest, { slug, contractHash: fp, generatedAt, role });
  }
  await appendAiTrace(backPath, backOut.id, makeAiTrace({ task: 'feature-back', provider: cfg.provider, model: cfg.model, system: result.back.trace?.system, user: result.back.trace?.user, output: result.back.trace?.raw }));
  await appendAiTrace(frontPath, frontOut.id, makeAiTrace({ task: 'feature-front', provider: cfg.provider, model: cfg.model, system: result.front.trace?.system, user: result.front.trace?.user, output: result.front.trace?.raw }));
  if (mobileOut) await appendAiTrace(mobilePath, mobileOut.id, makeAiTrace({ task: 'feature-movil', provider: cfg.provider, model: cfg.model, system: result.mobile.trace?.system, user: result.mobile.trace?.user, output: result.mobile.trace?.raw }));

  for (const [role, out] of outs) console.log((role === 'back' ? '\n' : '') + c.green('✓ ' + t('featSpecWritten', sideDisp(role), join(out.rel))));
  console.log(c.dim('  ' + t('featContractAt', 'contracts/api.md')));

  // 9) Rama de feature (opt-in), nombrada por el slug. SOLO se crea si el repo estaba limpio antes
  // (si tenía cambios sin commitear, no la creo para no arrastrar tu trabajo pendiente). Los specs nuevos viajan con ella.
  const branchName = `feat/${slug}`;
  const branchCreated = { front: false, back: false, movil: false };
  if (wantBranch) {
    // TODO O NADA: la feature debe quedar en la MISMA rama en todos los repos (R7). Si alguno está sucio, no creo ninguna.
    const dirty = sides.filter(([name]) => gitState[name]?.reason === 'dirty').map(([name]) => sideDisp(name));
    if (dirty.length) {
      console.log('  ' + c.yellow('!') + ' ' + t('featBranchSkipDirty', dirty.join(' / ')));
    } else {
      for (const [name, p] of sides) {
        const b = await createFeatureBranch(p, branchName);
        branchCreated[name] = b.ok;
        console.log('  ' + (b.ok ? c.green('✓') : c.yellow('!')) + ' ' + t('featBranch', sideDisp(name), b.branch, t('gitBranch_' + b.reason.replace(/-/g, '_'))));
      }
    }
  } else {
    console.log(c.dim('\n  ' + t('featBranchHint', branchName)));
  }

  console.log('\n' + c.green('✓ ' + t('featDone', !!mobilePath)));

  // Hand-off ÚNICO del orquestador: un solo mensaje que coordina todos los repos alrededor del contrato.
  console.log('\n' + c.bold(t('handoff')) + '\n');
  console.log(c.cyan(featureHandoff({
    backPath, backRel: backOut.rel, frontPath, frontRel: frontOut.rel,
    mobilePath, mobileRel: mobileOut?.rel || '', branch: branchName,
    backBranchCreated: branchCreated.back, frontBranchCreated: branchCreated.front,
    mobileBranchCreated: branchCreated.movil, specLang
  })) + '\n');
}

// ---------- modo worktree (spec 005): puerta → HUs → workspaces aislados por HU ----------
// Cada HU termina en <base>/NNN-slug/ con un worktree por repo (back/, front/, movil/) sobre la
// rama feat/<slug>, sus specs DENTRO y el hand-off en la raíz. El árbol principal de cada repo
// queda intacto (R9). chalc nunca ejecuta agentes, ni commitea, ni borra worktrees.
async function runFeatureWorktree({ cfg, prompter, backPath, frontPath, mobilePath, backStack, frontStack, mobileStack }) {
  // Lados en el ORDEN del workspace: el back manda el contrato; las carpetas serán back/, front/, movil/.
  const wsSides = [
    { name: 'back', path: backPath }, { name: 'front', path: frontPath },
    ...(mobilePath ? [{ name: 'movil', path: mobilePath }] : [])
  ];
  const sideLabel = (name) => (name === 'movil' ? t('sideMobile') : name);

  // 1) Puerta bloqueante (R3, R4): ni un token ni un archivo hasta que TODOS los repos pasen.
  //    En interactivo se re-verifica cuando el usuario resuelva; en no interactivo, aborta.
  console.log('\n' + c.bold('🔎 ' + t('featGateHdr')));
  for (;;) {
    const gate = await workspaceGate(wsSides);
    for (const r of gate.results) {
      console.log('  ' + (r.ok ? c.green('✓') : c.yellow('!')) + ' ' + t('featGit', sideLabel(r.name), t('gitReason_' + r.reason.replace(/-/g, '_'))));
    }
    if (gate.ok) break;
    if (!prompter || !(await prompter.yesno(t('featGateRetryQ'), true))) {
      if (prompter) prompter.close();
      console.error(c.yellow('! ' + t('featGateAbort')));
      process.exit(1);
    }
  }

  // 2) Idioma del spec + modo SDD (mismos criterios que el camino normal).
  const specLang = await askSpecLang(prompter);
  const mode = await askSddMode(prompter, backPath);

  // 3) Captura multi-HU (R5): una o más historias ANTES de generar nada. No interactivo: una sola (por flags).
  const userStories = [];
  do {
    if (prompter) console.log('\n' + c.bold('📝 ' + t('featHuLabel', userStories.length + 1)));
    const hu = await acquireUserStory(prompter);
    if (hu.trim()) userStories.push(hu);
  } while (prompter && await prompter.yesno(t('featAnotherHuQ'), false));
  if (!userStories.length) { if (prompter) prompter.close(); console.error(c.red('✗ ' + t('docEmpty'))); process.exit(1); }

  // 4) Carpeta base de workspaces (R8): flag > recordada > hermana del back. Escriba lo que
  //    escriba el usuario, se trabaja SIEMPRE dentro de <ruta>/chalc-workspaces (normalizado,
  //    sin duplicar). Se recuerda para corridas futuras y para el dashboard (spec 006).
  let baseDir = flags['workspace-dir'] ? workspaceBaseDir(resolve(cleanPath(String(flags['workspace-dir'])))) : '';
  if (!baseDir) {
    const def = (await recallWorkspaceDir()) || workspaceBaseDir(dirname(backPath));
    if (prompter) {
      const ans = (await prompter.text(t('featWorkspaceDirQ') + ' ' + c.dim(`[${disp(def)}]`) + ':')).trim();
      baseDir = ans ? workspaceBaseDir(resolve(cleanPath(ans))) : def;
    } else { baseDir = def; }
  }
  await rememberWorkspaceDir(baseDir);
  if (prompter) prompter.close();

  // 5) Generar TODAS las HUs en secuencia (R7: cada contrato ve los previos). Las plantillas se
  //    leen de los repos principales (mismo contenido que tendrán los worktrees); si un repo no
  //    está equipado, cae al catálogo — los repos principales NO se tocan (R9).
  const backContext = existsSync(join(backPath, 'docs', 'architecture.md')) ? await readFile(join(backPath, 'docs', 'architecture.md'), 'utf8') : '';
  const backScaffold = await loadSpecScaffold(backPath, mode, specLang);
  const frontScaffold = await loadSpecScaffold(frontPath, mode, specLang);
  const mobileScaffold = mobilePath ? await loadSpecScaffold(mobilePath, mode, specLang) : null;
  const spin = startSpinner(t('featOrchestrating', !!mobilePath));
  let results;
  try {
    results = await orchestrateFeatures({
      cfg, userStories, language: specLang, mode, backContext,
      back: { stack: backStack, templates: backScaffold.templates, constitution: backScaffold.constitution },
      front: { stack: frontStack, templates: frontScaffold.templates, constitution: frontScaffold.constitution },
      mobile: mobileScaffold ? { stack: mobileStack, templates: mobileScaffold.templates, constitution: mobileScaffold.constitution } : null
    });
  } finally { stopSpinner(spin); }

  // 6) Reserva de números (R6): base compartida una vez; +1 por HU en memoria (los repos
  //    principales no cambian durante la corrida, re-consultar el disco daría siempre el mismo).
  const baseNum = parseInt(await sharedNumber(wsSides.map(({ path }) => join(path, 'specs'))), 10);

  // 7) Colocación por HU: workspace + worktrees (todo-o-nada, R10) y TODO dentro del worktree (R9).
  console.log('');
  const generatedAt = new Date().toISOString();
  const workspaces = [];      // { id, branch, dir } de las HUs colocadas
  const contractsById = [];   // para el lint de rutas entre HUs (R7)
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const slug = (r.front.feature || r.back.feature || 'feature').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'feature';
    const num = String(baseNum + i).padStart(3, '0');   // reservado (R6): base + posición de la HU
    const id = `${num}-${slug}`;
    const branchName = `feat/${slug}`;
    const plan = planWorkspace(baseDir, id, wsSides);
    const created = await createWorkspace(plan, branchName);
    if (!created.ok) {
      const detail = created.failures.map((f) => `${sideLabel(f.name)}: ${f.reason}`).join(' · ');
      console.log('  ' + c.yellow('!') + ' ' + t('featWorkspaceFailed', id, detail));
      continue;   // esa HU queda sin colocar; las demás siguen (R10)
    }
    contractsById.push({ id, contract: r.contract });
    const fp = contractFingerprint(r.contract);
    const stamp = contractStamp(fp, generatedAt);
    const sideResults = { back: r.back, front: r.front, movil: r.mobile };
    for (const side of plan.sides) {
      const spec = sideResults[side.name];
      await equipForSpec(side.dest, mode, readTarget(side.repo), specLang);   // skills DENTRO del worktree (R9)
      const out = await writeSideSpec(side.dest, slug, stampFiles(spec.files, stamp), num);
      await mkdir(join(out.dest, 'contracts'), { recursive: true });
      await writeFile(join(out.dest, 'contracts', 'api.md'), r.contract.replace(/\s*$/, '') + '\n');
      await writeContractLock(out.dest, { slug, contractHash: fp, generatedAt, role: side.name });
      await appendAiTrace(side.dest, out.id, makeAiTrace({ task: 'feature-' + side.name, provider: cfg.provider, model: cfg.model, system: spec.trace?.system, user: spec.trace?.user, output: spec.trace?.raw }));
    }
    const handoffText = featureWorkspaceHandoff({ id, branch: branchName, specLang, hasMobile: !!mobilePath });
    await writeHandoff(plan.dir, handoffText);
    workspaces.push({ id, branch: branchName, dir: plan.dir, handoff: handoffText });
    console.log('  ' + c.green('✓') + ' ' + t('featWorkspaceCreated', id, disp(plan.dir)));
  }

  // 8) Lint de rutas entre HUs (R7): advertencia, nunca aborta.
  for (const dup of findDuplicateRoutes(contractsById)) {
    console.log('  ' + c.yellow('!') + ' ' + t('featDupRoute', dup.method, dup.path, dup.ids.join(' / ')));
  }
  if (!workspaces.length) { console.error(c.red('✗ ' + t('featGateAbort'))); process.exit(1); }

  // 9) Tabla resumen + hand-offs (R11): además del archivo, cada prompt se imprime bajo su
  //    separador — listo para pegar en su panel, igual que el flujo individual.
  console.log('\n' + c.bold(t('featWsTableHead')));
  for (const w of workspaces) console.log(`  ${w.id}  ·  ${w.branch}  ·  ${disp(w.dir)}`);
  console.log(c.dim('  ' + t('featHandoffAt')));
  console.log('\n' + c.bold(t('handoff')));
  for (const w of workspaces) {
    console.log('\n' + c.bold(`────────── ${w.id} ──────────`));
    console.log(c.cyan(w.handoff));
  }

  // 10) Terminales (R12, R13): el script se escribe SIEMPRE; la ventana solo si el usuario quiere.
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

  console.log('\n' + c.green('✓ ' + t('featDone', !!mobilePath)));
}
