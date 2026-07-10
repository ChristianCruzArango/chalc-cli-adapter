// Comando `chalc feature` (orquestador full-stack: HU → contrato + spec back + spec front) y su hand-off.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { t, lang } from '../i18n.mjs';
import { configForTask, isConfigured } from '../ai.mjs';
import { orchestrateFeature } from '../featureorch.mjs';
import { contractFingerprint, contractStamp, stampFiles, sharedNumber, readContractLock, writeContractLock } from '../specfolder.mjs';
import { safePull, createFeatureBranch } from '../gitprep.mjs';
import { appendAiTrace, makeAiTrace } from '../aitrace.mjs';
import { setTokenLogProject } from '../tokenlog.mjs';
import { c, cleanPath, dryRun, flags, interactive, positional } from './context.mjs';
import { askExistingPath, makePrompter, startSpinner, stopSpinner } from './prompter.mjs';
import { equipForSpec } from './equip.mjs';
import { detectStackLabel, loadSpecScaffold, writeSideSpec } from './spec.mjs';
import { configureAi, printAiLine, resolveAiTaskConfig } from './ai.mjs';
import { acquireUserStory, langName } from './specgen.mjs';

// Hand-off ÚNICO para el orquestador full-stack: un solo mensaje que coordina los dos repos alrededor del
// contrato. No son dos mensajes por repo: es la instrucción del orquestador. Sigue el idioma del spec.
export function featureHandoff({ backPath, backRel, frontPath, frontRel, branch, backBranchCreated, frontBranchCreated, specLang }) {
  const code = String(specLang).toLowerCase();
  const en = !(/espa|spanish|castell/.test(code) || code === 'es' || (!specLang && lang === 'es'));
  const both = backBranchCreated && frontBranchCreated;
  const none = !backBranchCreated && !frontBranchCreated;
  const branchNote = en
    ? (both ? `chalc already created it in both` : none ? `create it in each repo: git checkout -b ${branch}` : `chalc created it where the tree was clean; create it where missing: git checkout -b ${branch}`)
    : (both ? `chalc ya la creó en ambos` : none ? `créala en cada repo: git checkout -b ${branch}` : `chalc la creó donde el árbol estaba limpio; donde falte, créala: git checkout -b ${branch}`);
  if (en) {
    return [
      `You are the ORCHESTRATOR of this full-stack feature. You coordinate TWO repos around a single API contract, with Spec-Driven Development and strict TDD.`,
      ``,
      `📜 Contract (source of truth, identical in both specs): \`contracts/api.md\`. Every endpoint, request/response and error comes from there — invent nothing outside it.`,
      ``,
      `Repos:`,
      `- BACKEND (exposes the API):  \`${backPath}\`  → spec: \`${backRel}/\``,
      `- FRONTEND (consumes the API): \`${frontPath}\`  → spec: \`${frontRel}/\``,
      ``,
      `How to orchestrate:`,
      `1. Start with the BACKEND (it owns the contract). Read \`${backRel}/contracts/api.md\`, \`specs/constitution.md\` and \`${backRel}/spec.md\` (R1, R2… in EARS). Follow \`${backRel}/plan.md\` and execute \`${backRel}/tasks.md\` ONE task at a time. Implement EXACTLY the contract's endpoints.`,
      `2. Then the FRONTEND. Same with \`${frontRel}/\`, but CONSUMING the contract (same routes/shapes); don't reimplement backend logic.`,
      `3. R# are SHARED: the same R# is satisfied on backend and/or frontend — keep cross-repo traceability.`,
      `4. Per task, strict TDD: failing test (Red) → minimum code (Green) → refactor. Never code without a failing test first.`,
      `5. Before each task, state which R# and which repo; when done, stop and wait for my OK.`,
      `6. Branch \`${branch}\` in each repo (${branchNote}).`,
      `7. If something is [NEEDS CLARIFICATION] in the contract or a spec, ask me first. The spec is the source of truth: if scope changes, update spec and contract first.`
    ].join('\n');
  }
  return [
    `Eres el ORQUESTADOR de esta feature full-stack. Coordinas DOS repos alrededor de un único contrato de API, con Spec-Driven Development y TDD estricto.`,
    ``,
    `📜 Contrato (fuente de verdad, idéntico en ambas specs): \`contracts/api.md\`. Todo endpoint, request/response y error sale de ahí — no inventes nada fuera del contrato.`,
    ``,
    `Repos:`,
    `- BACKEND (expone la API):  \`${backPath}\`  → spec: \`${backRel}/\``,
    `- FRONTEND (consume la API): \`${frontPath}\`  → spec: \`${frontRel}/\``,
    ``,
    `Cómo orquestar:`,
    `1. Empieza por el BACKEND (es dueño del contrato). Lee \`${backRel}/contracts/api.md\`, \`specs/constitution.md\` y \`${backRel}/spec.md\` (R1, R2… en EARS). Sigue \`${backRel}/plan.md\` y ejecuta \`${backRel}/tasks.md\` UNA tarea a la vez. Implementa EXACTAMENTE los endpoints del contrato.`,
    `2. Sigue con el FRONTEND. Igual con \`${frontRel}/\`, pero CONSUMIENDO el contrato (mismas rutas/shapes); no reimplementes la lógica del back.`,
    `3. Los R# son COMPARTIDOS: el mismo R# se cumple en back y/o front — mantén la trazabilidad cruzada.`,
    `4. Por tarea, TDD estricto: test que falla (Red) → mínimo código (Green) → refactor. Nunca código sin un test que falle primero.`,
    `5. Antes de cada tarea di qué R# y en qué repo; al terminar, párate y espera mi OK.`,
    `6. Rama \`${branch}\` en cada repo (${branchNote}).`,
    `7. Si algo está [NEEDS CLARIFICATION] en el contrato o una spec, pregúntame antes. La spec es la fuente de verdad: si cambia el alcance, actualiza spec y contrato primero.`
  ].join('\n');
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

  // 1) Rutas: front y back. Obligatorias: si las dejas vacías o inexistentes, re-pregunta (no deja pasar).
  let frontPath = positional[1] ? resolve(cleanPath(positional[1])) : (prompter ? await askExistingPath(prompter, t('featFrontQ')) : process.cwd());
  let backPath = flags.back ? resolve(cleanPath(String(flags.back))) : '';
  if (!backPath && prompter && (opts.assumeBack || await prompter.yesno(t('featHasBackQ'), true))) {
    backPath = await askExistingPath(prompter, t('featBackPathQ'));
  }
  if (!backPath) { if (prompter) prompter.close(); console.error(c.yellow('! ' + t('featNoBack'))); process.exit(1); }
  for (const p of [frontPath, backPath]) {
    if (!existsSync(p)) { if (prompter) prompter.close(); console.error(c.red('✗ ' + t('pathMissing', p))); process.exit(1); }
  }
  setTokenLogProject(frontPath);   // el histórico de consumo del feature vive en el repo front (ver spec 002, fuera de alcance)
  // Identifica los stacks YA, para que el usuario confirme que reconoció bien cada repo antes de seguir.
  const frontStack = await detectStackLabel(frontPath);
  const backStack = await detectStackLabel(backPath);
  console.log('  ' + c.green('✓') + ' ' + t('featDetect', frontStack || c.yellow(t('featUnknownStack')), backStack || c.yellow(t('featUnknownStack'))));
  if (!frontStack || !backStack) console.log(c.dim('  ' + t('featUnknownHint')));
  // Se decide ahora; se crea al final (el nombre sale del slug). --no-branch evita la pregunta.
  const wantBranch = flags.branch ?? (prompter ? await prompter.yesno(t('featBranchQ'), false) : false);

  // 2) Idioma del spec + modo (del back si está equipado).
  let specLang = flags.lang ? langName(String(flags.lang)) : null;
  if (prompter && !specLang) {
    const optsL = [{ label: 'Español', value: 'español' }, { label: 'English', value: 'English' }, { label: t('otherLang'), value: '__other' }];
    const idx = await prompter.select(t('specLangQ'), optsL.map((o) => ({ label: o.label })), lang === 'en' ? 1 : 0);
    specLang = optsL[idx].value;
    if (specLang === '__other') specLang = (await prompter.text(t('otherLangQ') + ':')).trim() || langName(lang);
  }
  if (!specLang) specLang = langName(lang);
  const readTarget = (p) => { try { return JSON.parse(readFileSync(join(p, '.chalc.json'), 'utf8')).target || 'claude'; } catch { return 'claude'; } };
  const readMode = (p) => { try { const m = (JSON.parse(readFileSync(join(p, '.chalc.json'), 'utf8')).methods || []).find((x) => String(x).startsWith('sdd')); return m && String(m).includes(':') ? String(m).split(':')[1] : 'lite'; } catch { return 'lite'; } };
  // Modo SDD: --full/--mode mandan; si no, lee el modo ACTUAL del back y pregunta si quieres cambiarlo.
  let mode = flags.full ? 'full' : String(flags.mode || '').toLowerCase();
  if (mode !== 'lite' && mode !== 'full') {
    const current = readMode(backPath);                          // lo que ya tiene equipado el back (default lite)
    if (prompter) {
      const other = current === 'full' ? 'lite' : 'full';
      mode = (await prompter.yesno(t('sddModeCurrentQ', current, other), false)) ? other : current;
    } else { mode = current; }
  }

  // 3) HU.
  const userStory = await acquireUserStory(prompter);
  if (!userStory.trim()) { if (prompter) prompter.close(); console.error(c.red('✗ ' + t('docEmpty'))); process.exit(1); }

  // 4) Estado Git PREVIO + readiness. El git va PRIMERO: equipar escribe archivos y ensuciaría el árbol,
  // así que capturamos aquí el estado real (limpio/sucio) para decidir luego si es seguro crear la rama.
  if (prompter) prompter.close();
  console.log('\n' + c.bold('🔎 ' + t('featReadiness')));
  const gitState = {};
  for (const [name, p] of [['front', frontPath], ['back', backPath]]) {
    const pull = await safePull(p);
    gitState[name] = pull;
    const mark = pull.ok ? c.green('✓') : c.yellow('!');
    console.log('  ' + mark + ' ' + t('featGit', name, t('gitReason_' + pull.reason.replace(/-/g, '_'))));
  }
  const skillsFront = await equipForSpec(frontPath, mode, readTarget(frontPath), specLang);
  const skillsBack = await equipForSpec(backPath, mode, readTarget(backPath), specLang);
  console.log('  ' + c.green('✓') + ' ' + t('featReadyRepo', 'front', skillsFront.length));
  console.log('  ' + c.green('✓') + ' ' + t('featReadyRepo', 'back', skillsBack.length));

  // 6) Contexto del back para el contrato (architecture.md si existe). Los stacks ya se detectaron arriba.
  const backContext = existsSync(join(backPath, 'docs', 'architecture.md')) ? await readFile(join(backPath, 'docs', 'architecture.md'), 'utf8') : '';

  // 7) Orquestar: contrato → spec back → spec front.
  const backScaffold = await loadSpecScaffold(backPath, mode, specLang);
  const frontScaffold = await loadSpecScaffold(frontPath, mode, specLang);
  const spin = startSpinner(t('featOrchestrating'));
  let result;
  try {
    result = await orchestrateFeature({
      cfg, userStory, language: specLang, mode, backContext,
      back: { stack: backStack, templates: backScaffold.templates, constitution: backScaffold.constitution },
      front: { stack: frontStack, templates: frontScaffold.templates, constitution: frontScaffold.constitution }
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
  const sharedNum = await sharedNumber([join(frontPath, 'specs'), join(backPath, 'specs')]);
  const backOut = await writeSideSpec(backPath, slug, stampFiles(result.back.files, stamp), sharedNum);
  const frontOut = await writeSideSpec(frontPath, slug, stampFiles(result.front.files, stamp), sharedNum);
  for (const [role, out] of [['back', backOut], ['front', frontOut]]) {
    if (out.reused) console.log('  ' + c.yellow('!') + ' ' + t('featReusingFolder', role, out.id));
    const prev = await readContractLock(out.dest);
    if (prev && prev.contractHash !== fp) console.log('  ' + c.yellow('!') + ' ' + t('featContractRefreshed', role));
    await mkdir(join(out.dest, 'contracts'), { recursive: true });
    await writeFile(join(out.dest, 'contracts', 'api.md'), result.contract.replace(/\s*$/, '') + '\n');
    await writeContractLock(out.dest, { slug, contractHash: fp, generatedAt, role });
  }
  await appendAiTrace(backPath, backOut.id, makeAiTrace({ task: 'feature-back', provider: cfg.provider, model: cfg.model, system: result.back.trace?.system, user: result.back.trace?.user, output: result.back.trace?.raw }));
  await appendAiTrace(frontPath, frontOut.id, makeAiTrace({ task: 'feature-front', provider: cfg.provider, model: cfg.model, system: result.front.trace?.system, user: result.front.trace?.user, output: result.front.trace?.raw }));

  console.log('\n' + c.green('✓ ' + t('featSpecWritten', 'back', join(backOut.rel))));
  console.log(c.green('✓ ' + t('featSpecWritten', 'front', join(frontOut.rel))));
  console.log(c.dim('  ' + t('featContractAt', 'contracts/api.md')));

  // 9) Rama de feature (opt-in), nombrada por el slug. SOLO se crea si el repo estaba limpio antes
  // (si tenía cambios sin commitear, no la creo para no arrastrar tu trabajo pendiente). Los specs nuevos viajan con ella.
  const branchName = `feat/${slug}`;
  const branchCreated = { front: false, back: false };
  if (wantBranch) {
    // TODO O NADA: la feature debe quedar en la MISMA rama en ambos repos. Si alguno está sucio, no creo ninguna.
    const dirty = [['front', frontPath], ['back', backPath]].filter(([name]) => gitState[name]?.reason === 'dirty').map(([name]) => name);
    if (dirty.length) {
      console.log('  ' + c.yellow('!') + ' ' + t('featBranchSkipDirty', dirty.join(' / ')));
    } else {
      for (const [name, p] of [['front', frontPath], ['back', backPath]]) {
        const b = await createFeatureBranch(p, branchName);
        branchCreated[name] = b.ok;
        console.log('  ' + (b.ok ? c.green('✓') : c.yellow('!')) + ' ' + t('featBranch', name, b.branch, t('gitBranch_' + b.reason.replace(/-/g, '_'))));
      }
    }
  } else {
    console.log(c.dim('\n  ' + t('featBranchHint', branchName)));
  }

  console.log('\n' + c.green('✓ ' + t('featDone')));

  // Hand-off ÚNICO del orquestador: un solo mensaje que coordina ambos repos alrededor del contrato.
  console.log('\n' + c.bold(t('handoff')) + '\n');
  console.log(c.cyan(featureHandoff({
    backPath, backRel: backOut.rel, frontPath, frontRel: frontOut.rel, branch: branchName,
    backBranchCreated: branchCreated.back, frontBranchCreated: branchCreated.front, specLang
  })) + '\n');
}
