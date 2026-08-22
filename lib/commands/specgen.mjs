// Comando `chalc spec-ia` (documento → SDD con IA), la ingesta de HU/documentos y el hand-off.

import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { t, lang, languageName } from '../i18n.mjs';
import { PROVIDERS, configForTask, isConfigured } from '../ai.mjs';
import { readDocument } from '../docread.mjs';
import { fetchAzureDevOps, fetchJira, fetchUrl } from '../sources.mjs';
import { buildPrompt, generateSpec } from '../specgen.mjs';
import { summarizeValidation } from '../specvalidate.mjs';
import { resolveFeatureFolder } from '../specfolder.mjs';
import { appendAiTrace, makeAiTrace } from '../aitrace.mjs';
import { setTokenLogProject } from '../tokenlog.mjs';
import { METHODS_DIR, c, cleanPath, dryRun, flags, interactive, positional } from './context.mjs';
import { langCode } from './catalogstore.mjs';
import { askExistingPath, makePrompter, readPasted, startSpinner, stopSpinner } from './prompter.mjs';
import { equipForSpec } from './equip.mjs';
import { configureAi, printAiLine, resolveAiTaskConfig } from './ai.mjs';
import { runFeature } from './feature.mjs';
import { advisorCycle } from '../gatehandoff.mjs';

// ---------- comando: chalc spec-gen (documento → SDD con IA) ----------
// La numeración e idempotencia de carpetas de spec vive en lib/specfolder.mjs (resolveFeatureFolder).

// Nombre de idioma para el spec: mapea códigos comunes (es→español), o usa el texto tal cual.
// El mapa vive en i18n (lo comparten spec-ia, feature y debate); aquí solo se conserva el nombre con
// el que ya lo importan sus consumidores.
export const langName = languageName;

export function handoffCommand(specPath, skills = [], specLang = '', opts = {}) {
  // El hand-off sigue el idioma del SPEC (lo que elegiste con --lang), no el del CLI.
  const code = String(specLang).toLowerCase();
  const isEs = /espa|spanish|castell/.test(code) || code === 'es' || (!specLang && lang === 'es');
  const en = !isEs;
  // Skills bajo demanda: no volcamos la lista completa (eso dispersa el foco). Decimos dónde están
  // y que abra solo la que necesita la tarea activa. `skills` se conserva por compatibilidad de firma.
  void skills;
  const skillsLine = en
    ? `Use the project's skills when a task needs one (they live in .claude/skills or .chalc/skills) — open only the one the current task needs, don't preload them all.`
    : `Usa las skills del proyecto cuando una tarea lo pida (están en .claude/skills o .chalc/skills); abre solo la que necesita la tarea activa, no las pre-cargues todas.`;
  // Rama de la feature. Si chalc ya la creó (opts.branchCreated) el paso 1 lo refleja; si no, pide crearla.
  // opts.branch fija el nombre exacto (para coincidir con el que creó chalc); por defecto feature/<NNN-nombre>.
  const branch = opts.branch || ('feature/' + specPath.replace(/^specs[/\\]/, ''));
  const step1 = opts.branchCreated
    ? (en ? `1. You're already on branch \`${branch}\` (chalc created it) — commit your work there.` : `1. Ya estás en la rama \`${branch}\` (la creó chalc) — commitea tu trabajo ahí.`)
    : (en ? `1. Create a branch for this feature (one branch per spec): \`git checkout -b ${branch}\`.` : `1. Crea una rama para esta feature (una rama por spec): \`git checkout -b ${branch}\`.`);
  if (en) {
    return [
      `Implement the feature in \`${specPath}/\` using Spec-Driven Development with strict TDD.`,
      ``,
      step1,
      `2. First read \`specs/constitution.md\` (non-negotiable principles) and \`${specPath}/spec.md\` (the EARS requirements R1, R2…).`,
      `3. Follow \`${specPath}/plan.md\` (architecture & decisions) and execute \`${specPath}/tasks.md\` in order, ONE task at a time: before each task state which R# it implements; when it's done, stop and wait for my OK before the next.`,
      `4. For each task, strict TDD: write the failing test first (Red) → minimum code to pass (Green) → refactor. Never write code without a failing test first.`,
      `5. Every test and file traces to its requirement (R#).`,
      `6. ${skillsLine} Respect "one thing per file" (interfaces / DTOs / types each in its own file).`,
      `7. Tooling/tests: use the test framework the project ALREADY has; don't invent config. If tooling is missing, the registry is private, or something won't compile, report it as a blocker and ask me — don't improvise or switch tools on your own.`,
      `8. If a requirement is marked [NEEDS CLARIFICATION], ask me before implementing it.`,
      `9. ${advisorCycle({ en: true }).join('\n')}`,
      `The spec is the source of truth: if scope changes, update the spec first.`
    ].join('\n');
  }
  return [
    `Implementa la feature en \`${specPath}/\` con Spec-Driven Development y TDD estricto.`,
    ``,
    step1,
    `2. Lee primero \`specs/constitution.md\` (principios no negociables) y \`${specPath}/spec.md\` (los requisitos R1, R2… en EARS).`,
    `3. Sigue \`${specPath}/plan.md\` (arquitectura y decisiones) y ejecuta \`${specPath}/tasks.md\` en orden, UNA tarea a la vez: antes de cada tarea di qué R# implementa; al terminarla, párate y espera mi OK antes de la siguiente.`,
    `4. Por cada tarea, TDD estricto: escribe el test que falla primero (Red) → el mínimo código para pasarlo (Green) → refactoriza. Nunca escribas código sin un test que falle primero.`,
    `5. Cada test y cada archivo traza a su requisito (R#).`,
    `6. ${skillsLine} Respeta "una cosa por archivo" (interfaces / DTOs / types cada uno en su archivo).`,
    `7. Herramientas/tests: usa el framework de pruebas que el proyecto YA tiene; no inventes configuración. Si falta tooling, el registro es privado o algo no compila, repórtalo como blocker y pregúntame — no improvises ni cambies de herramienta por tu cuenta.`,
    `8. Si un requisito está marcado [NEEDS CLARIFICATION], pregúntame antes de implementarlo.`,
    `9. ${advisorCycle({ en: false }).join('\n')}`,
    `La spec es la fuente de verdad: si cambia el alcance, actualiza la spec primero.`
  ].join('\n');
}

// Obtiene el texto de la HU/documento desde la fuente elegida (interactivo o por flags). Reusado por spec-ia y feature.
export async function acquireUserStory(prompter) {
  if (prompter) {
    const sources = [
      { v: 'file', label: t('srcFile') }, { v: 'azure', label: t('srcAzure') },
      { v: 'jira', label: t('srcJira') }, { v: 'url', label: t('srcUrl') }, { v: 'paste', label: t('srcPaste') }
    ];
    const src = sources[await prompter.select(t('sourceQ'), sources.map((s) => ({ label: s.label })), 0)].v;
    if (src === 'file') return readDocument(resolve(cleanPath(await prompter.text(t('docQ') + ':'))));
    if (src === 'paste') { console.log(c.dim('  ' + t('pasteQ'))); return readPasted(); }
    if (src === 'azure') {
      const url = await prompter.text(t('azureUrlQ') + ':'); const pat = await prompter.secret(t('patQ') + ':');
      console.log(c.dim('  ' + t('fetching'))); return fetchAzureDevOps({ url, pat });
    }
    if (src === 'jira') {
      const url = await prompter.text(t('jiraUrlQ') + ':'); const email = await prompter.text(t('emailQ') + ':'); const token = await prompter.secret(t('tokenQ') + ':');
      console.log(c.dim('  ' + t('fetching'))); return fetchJira({ url, email, token });
    }
    const url = await prompter.text(t('urlQ') + ':'); console.log(c.dim('  ' + t('fetching'))); return fetchUrl(url);
  }
  if (flags.doc) return readDocument(resolve(cleanPath(String(flags.doc))));
  if (flags.azure) return fetchAzureDevOps({ url: String(flags.azure), pat: String(flags.pat || process.env.CHALC_PAT || '') });
  if (flags.jira) return fetchJira({ url: String(flags.jira), email: String(flags.email || ''), token: String(flags.token || process.env.CHALC_TOKEN || '') });
  if (flags.url) return fetchUrl(String(flags.url));
  return '';
}

export async function runSpecGen() {
  console.log('\n' + c.bold('⚙️  chalc spec-ia') + (dryRun ? c.dim('  (dry-run)') : '') + '\n');
  const prompter = interactive ? makePrompter() : null;
  // Resolvemos la IA PRIMERO y mostramos proveedor/modelo, antes de cualquier pregunta (que el usuario sepa qué usa).
  let cfg = await resolveAiTaskConfig('spec');
  if (!dryRun && !isConfigured(cfg)) {
    if (!prompter) { console.error(c.red('✗ ' + t('aiNotConfigured'))); process.exit(1); }
    cfg = configForTask(await configureAi(prompter), 'spec');   // primera vez: configura la IA aquí mismo
  }
  printAiLine(cfg);   // muestra qué proveedor/modelo se usará
  // Si la HU tiene backend, esto es full-stack: delega al orquestador (contrato + spec back + spec front).
  if (prompter && !dryRun && !flags.back && await prompter.yesno(t('featHasBackQ'), false)) {
    prompter.close();
    return runFeature({ assumeBack: true });
  }

  let proj = positional[1] ? resolve(cleanPath(positional[1])) : (prompter ? await askExistingPath(prompter, t('pathQ')) : process.cwd());
  if (!existsSync(proj)) { if (prompter) prompter.close(); console.error(c.red('✗ ' + t('pathMissing', proj))); process.exit(1); }
  setTokenLogProject(proj);   // el histórico de consumo va al proyecto REAL (el del contexto es el verbo)

  // .chalc.json es OPCIONAL: un proyecto puede no estar equipado.
  const chalcJsonPath = join(proj, '.chalc.json');
  let chalcJson = {};
  if (existsSync(chalcJsonPath)) { try { chalcJson = JSON.parse(await readFile(chalcJsonPath, 'utf8')); } catch { /* .chalc.json corrupto: se ignora */ } }
  const sddEntry = (chalcJson.methods || []).find((m) => m === 'sdd' || String(m).startsWith('sdd:'));
  const mode = sddEntry && String(sddEntry).includes(':') ? String(sddEntry).split(':')[1] : 'lite';

  // Idioma del SPEC (el del proyecto), independiente del idioma del CLI. Por flag o preguntando.
  // Se decide ANTES de equipar, para montar la constitución/plantillas/reglas en ese idioma.
  let specLang = flags.lang ? langName(String(flags.lang)) : null;
  if (prompter && !specLang) {
    const optsL = [{ label: 'Español', value: 'español' }, { label: 'English', value: 'English' }, { label: t('otherLang'), value: '__other' }];
    const idx = await prompter.select(t('specLangQ'), optsL.map((o) => ({ label: o.label })), lang === 'en' ? 1 : 0);
    specLang = optsL[idx].value;
    if (specLang === '__other') specLang = (await prompter.text(t('otherLangQ') + ':')).trim() || langName(lang);
  }
  if (!specLang) specLang = langName(lang);

  const hadSdd = existsSync(join(proj, 'specs', 'constitution.md'));
  const specTarget = chalcJson.target || (flags.target ? String(flags.target) : 'claude');
  let equippedSkills = [];
  if (!dryRun) {
    equippedSkills = await equipForSpec(proj, mode, specTarget, specLang);   // equipa skills + SDD en el idioma del spec
    if (!hadSdd) console.log(c.dim('  ' + t('sddScaffolded')));
  }
  const specsDir = join(proj, 'specs');

  // Plantillas/constitución: del proyecto si existen; si no (ej. dry-run en proyecto crudo), del catálogo (idioma del spec).
  const base = mode === 'full' ? 'scaffold-full' : 'scaffold-lite';
  const scName = (langCode(specLang) === 'en' && existsSync(join(METHODS_DIR, 'sdd', `${base}-en`))) ? `${base}-en` : base;
  const catSpecs = join(METHODS_DIR, 'sdd', scName, 'specs');
  const tplDir = join(specsDir, '_template');
  const readIf = async (p, fb) => (existsSync(p) ? readFile(p, 'utf8') : (fb && existsSync(fb) ? readFile(fb, 'utf8') : ''));
  const templates = {
    spec: await readIf(join(tplDir, 'spec.md'), join(catSpecs, '_template', 'spec.md')),
    plan: await readIf(join(tplDir, 'plan.md'), join(catSpecs, '_template', 'plan.md')),
    tasks: await readIf(join(tplDir, 'tasks.md'), join(catSpecs, '_template', 'tasks.md'))
  };
  const constitution = await readIf(join(specsDir, 'constitution.md'), join(catSpecs, 'constitution.md'));

  const documentText = await acquireUserStory(prompter);
  if (!documentText.trim()) { if (prompter) prompter.close(); console.error(c.red('✗ ' + t('docEmpty'))); process.exit(1); }

  const feature = flags.feature ? String(flags.feature) : '';   // la IA lo infiere; no se pregunta

  const opts = { language: specLang, mode, documentText, templates, constitution };

  if (dryRun) {
    const { system, user } = await buildPrompt(opts);
    if (prompter) prompter.close();
    console.log(c.bold('\n--- SYSTEM PROMPT ---\n') + system);
    console.log(c.bold('\n--- USER ---\n') + user.slice(0, 1200) + (user.length > 1200 ? '\n' + t('specgenTruncated') : ''));
    console.log('\n' + c.dim(t('specgenDryRunNote') + '\n'));
    return;
  }

  if (prompter) prompter.close();
  console.log('');
  const spin = startSpinner(t('generating', cfg.model || PROVIDERS[cfg.provider].defaultModel));
  let result;
  try { result = await generateSpec(cfg, opts); }
  finally { stopSpinner(spin); }
  const validation = summarizeValidation(result.validation || []);
  if (result.validation?.length) {
    console.log(c.yellow('\n! ' + t('specgenValidation', validation.errors, validation.warnings)));
    for (const issue of result.validation.slice(0, 8)) {
      const mark = issue.level === 'error' ? c.red('✗') : c.yellow('!');
      console.log(`  ${mark} ${issue.message}`);
    }
    if (validation.errors) throw new Error(t('specgenValidationFailed'));
  }

  const feat = (feature || result.feature || 'feature').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'feature';
  // Idempotente: re-generar la misma feature actualiza su carpeta en sitio, no crea un NNN+1 duplicado.
  const folder = await resolveFeatureFolder(specsDir, feat);
  if (folder.reused) console.log('  ' + c.yellow('!') + ' ' + t('specReusingFolder', folder.name));
  const rel = join('specs', folder.name);
  const dest = join(proj, rel);
  await mkdir(dest, { recursive: true });
  // En full, la feature debe traer también data-model/research/quickstart/contracts: copio las
  // plantillas del modo y luego sobreescribo las 3 que la IA generó (spec/plan/tasks).
  const tplSrc = join(specsDir, '_template');
  if (existsSync(tplSrc)) await cp(tplSrc, dest, { recursive: true, force: false, errorOnExist: false, dereference: true });
  for (const [name, content] of Object.entries(result.files)) {
    await writeFile(join(dest, name), String(content).replace(/\s*$/, '') + '\n');
  }
  await appendAiTrace(proj, folder.name, makeAiTrace({
    task: 'spec',
    provider: cfg.provider,
    model: cfg.model,
    system: result.trace?.system,
    user: result.trace?.user,
    output: result.trace?.raw,
    extra: { validation }
  }));
  console.log('\n' + c.green('✓ ' + t('specWritten', rel)));
  console.log('\n' + c.bold(t('handoff')) + '\n');
  console.log(c.cyan(handoffCommand(rel, equippedSkills, specLang)) + '\n');
}
