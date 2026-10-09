// Comando `chalc spec-ia` (documento → SDD con IA), la ingesta de HU/documentos y el hand-off.

import { cp, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { t } from '../i18n.mjs';
import { readJsonOrKeep, writeKeepingPrevious } from '../userdata.mjs';
import { slugify } from '../slug.mjs';
import { PROVIDERS, configForTask, isConfigured } from '../ai.mjs';
import { buildPrompt, generateSpec } from '../specgen.mjs';
import { acquireUserStory, askSpecLang } from './storyinput.mjs';
import { summarizeValidation } from '../specvalidate.mjs';
import { resolveFeatureFolder } from '../specfolder.mjs';
import { appendAiTrace, makeAiTrace } from '../aitrace.mjs';
import { setTokenLogProject } from '../tokenlog.mjs';
import { c, cleanPath, dryRun, flags, interactive, positional } from './context.mjs';
import { askExistingPath, makePrompter, startSpinner, stopSpinner } from './prompter.mjs';
import { equipForSpec } from './equip.mjs';
import { configureAi, printAiLine, resolveAiTaskConfig } from './ai.mjs';
import { runFeature } from './feature.mjs';
import { loadSpecScaffold } from './spec.mjs';
import { advisorCycle } from '../gatehandoff.mjs';
import { exitCommand } from './exit.mjs';
import { sddModeOf } from './catalogstore.mjs';
import { handoffLang } from './featurehandoff.mjs';

// ---------- comando: chalc spec-gen (documento → SDD con IA) ----------
// La numeración e idempotencia de carpetas de spec vive en lib/specfolder.mjs (resolveFeatureFolder).

// Las piezas del hand-off que cambian según el caso, por idioma.
const HANDOFF_WORDS = {
  es: {
    skillsLine: 'Usa las skills del proyecto cuando una tarea lo pida (están en .claude/skills o .chalc/skills); abre solo la que necesita la tarea activa, no las pre-cargues todas.',
    onBranch: (b) => `1. Ya estás en la rama \`${b}\` (la creó chalc) — commitea tu trabajo ahí.`,
    createBranch: (b) => `1. Crea una rama para esta feature (una rama por spec): \`git checkout -b ${b}\`.`
  },
  en: {
    skillsLine: 'Use the project\'s skills when a task needs one (they live in .claude/skills or .chalc/skills) — open only the one the current task needs, don\'t preload them all.',
    onBranch: (b) => `1. You're already on branch \`${b}\` (chalc created it) — commit your work there.`,
    createBranch: (b) => `1. Create a branch for this feature (one branch per spec): \`git checkout -b ${b}\`.`
  }
};

// Los pasos del hand-off en inglés y en español; `step1` y `skillsLine` cambian según el caso.
function handoffEn(specPath, step1, skillsLine) {
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

function handoffEs(specPath, step1, skillsLine) {
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

export function handoffCommand(specPath, skills = [], specLang = '', opts = {}) {
  // El hand-off sigue el idioma del SPEC (lo que elegiste con --lang), no el del CLI.
  const language = handoffLang(specLang);
  const words = HANDOFF_WORDS[language];
  // Skills bajo demanda: no volcamos la lista completa (eso dispersa el foco). Decimos dónde están
  // y que abra solo la que necesita la tarea activa. `skills` se conserva por compatibilidad de firma.
  void skills;
  // Rama de la feature. Si chalc ya la creó (opts.branchCreated) el paso 1 lo refleja; si no, pide crearla.
  // opts.branch fija el nombre exacto (para coincidir con el que creó chalc); por defecto feature/<NNN-nombre>.
  const branch = opts.branch || ('feature/' + specPath.replace(/^specs[/\\]/, ''));
  const step1 = opts.branchCreated ? words.onBranch(branch) : words.createBranch(branch);
  return (language === 'en' ? handoffEn : handoffEs)(specPath, step1, words.skillsLine);
}

// La IA de la tarea `spec`, configurándola aquí mismo la primera vez si hay a quién preguntar.
async function specAiConfig(prompter) {
  let cfg = await resolveAiTaskConfig('spec');
  if (!dryRun && !isConfigured(cfg)) {
    if (!prompter) { console.error(c.red('✗ ' + t('aiNotConfigured'))); exitCommand(1); }
    cfg = configForTask(await configureAi(prompter), 'spec');
  }
  return cfg;
}

// .chalc.json es OPCIONAL: un proyecto puede no estar equipado. Devuelve su contenido y el modo SDD.
async function projectSddMode(proj) {
  const chalcJson = await readJsonOrKeep(join(proj, '.chalc.json'), {});   // ilegible: se respalda y se avisa
  return { chalcJson, mode: sddModeOf(chalcJson) };
}

// Equipa skills + SDD en el idioma del spec. Devuelve las skills equipadas.
async function equipProject(proj, { mode, chalcJson, specLang }) {
  const hadSdd = existsSync(join(proj, 'specs', 'constitution.md'));
  const specTarget = chalcJson.target || (flags.target ? String(flags.target) : 'claude');
  const skills = await equipForSpec(proj, mode, specTarget, { specLang });
  if (!hadSdd) console.log(c.dim('  ' + t('sddScaffolded')));
  return skills;
}

async function printSpecDryRun(opts) {
  const { system, user } = await buildPrompt(opts);
  console.log(c.bold('\n--- SYSTEM PROMPT ---\n') + system);
  console.log(c.bold('\n--- USER ---\n') + user.slice(0, 1200) + (user.length > 1200 ? '\n' + t('specgenTruncated') : ''));
  console.log('\n' + c.dim(t('specgenDryRunNote') + '\n'));
}

// Genera el SDD con la IA y muestra (y hace cumplir) su validación.
async function generateValidated(cfg, opts) {
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
  return { result, validation };
}

// Escribe la carpeta de la feature y su traza de IA. Devuelve su ruta relativa (specs/NNN-nombre).
async function writeSpecFolder(proj, specsDir, { feature, result, validation, cfg }) {
  const feat = slugify(feature || result.feature || 'feature') || 'feature';
  // Idempotente: re-generar la misma feature actualiza su carpeta en sitio, no crea un NNN+1 duplicado.
  const folder = await resolveFeatureFolder(specsDir, feat);
  if (folder.reused) console.log('  ' + c.yellow('!') + ' ' + t('specReusingFolder', folder.name));
  const rel = join('specs', folder.name);
  const dest = join(proj, rel);
  await mkdir(dest, { recursive: true });
  // En full, la feature debe traer también data-model/research/quickstart/contracts: copio las
  // plantillas del modo y luego sobreescribo las 3 que la IA generó (spec/plan/tasks). Solo se
  // respalda lo que ya estaba antes de la plantilla: eso sí puede llevar trabajo del usuario.
  const existed = new Set(Object.keys(result.files).filter((name) => existsSync(join(dest, name))));
  const tplSrc = join(specsDir, '_template');
  if (existsSync(tplSrc)) await cp(tplSrc, dest, { recursive: true, force: false, errorOnExist: false, dereference: true });
  for (const [name, content] of Object.entries(result.files)) {
    const text = String(content).replace(/\s*$/, '') + '\n';
    if (existed.has(name)) await writeKeepingPrevious(proj, join(dest, name), text);
    else await writeFile(join(dest, name), text);
  }
  await appendAiTrace(proj, folder.name, makeAiTrace({
    task: 'spec', provider: cfg.provider, model: cfg.model,
    system: result.trace?.system, user: result.trace?.user, output: result.trace?.raw,
    extra: { validation }
  }));
  return rel;
}

export async function runSpecGen() {
  console.log('\n' + c.bold('⚙️  chalc spec-ia') + (dryRun ? c.dim('  (dry-run)') : '') + '\n');
  const prompter = interactive ? makePrompter() : null;
  const close = () => { if (prompter) prompter.close(); };
  // Resolvemos la IA PRIMERO y mostramos proveedor/modelo, antes de cualquier pregunta (que el usuario sepa qué usa).
  const cfg = await specAiConfig(prompter);
  printAiLine(cfg);
  // Si la HU tiene backend, esto es full-stack: delega al orquestador (contrato + spec back + spec front).
  if (prompter && !dryRun && !flags.back && await prompter.yesno(t('featHasBackQ'), false)) {
    prompter.close();
    return runFeature({ assumeBack: true });
  }

  const proj = positional[1] ? resolve(cleanPath(positional[1])) : (prompter ? await askExistingPath(prompter, t('pathQ')) : process.cwd());
  if (!existsSync(proj)) { close(); console.error(c.red('✗ ' + t('pathMissing', proj))); exitCommand(1); }
  setTokenLogProject(proj);   // el histórico de consumo va al proyecto REAL (el del contexto es el verbo)
  const { chalcJson, mode } = await projectSddMode(proj);
  // Se decide ANTES de equipar, para montar la constitución/plantillas/reglas en ese idioma.
  const specLang = await askSpecLang(prompter);

  const equippedSkills = dryRun ? [] : await equipProject(proj, { mode, chalcJson, specLang });
  // Plantillas, constitución y conceptos: del proyecto si existen; si no (ej. dry-run en proyecto
  // crudo), del catálogo en el idioma del spec. Es el mismo lector que usa `chalc feature`.
  const { templates, constitution, specsDir, concepts } = await loadSpecScaffold(proj, mode, specLang);

  const documentText = await acquireUserStory(prompter);
  if (!documentText.trim()) { close(); console.error(c.red('✗ ' + t('docEmpty'))); exitCommand(1); }
  const feature = flags.feature ? String(flags.feature) : '';   // la IA lo infiere; no se pregunta
  const opts = { language: specLang, mode, documentText, templates, constitution, concepts };
  close();
  if (dryRun) return printSpecDryRun(opts);

  const { result, validation } = await generateValidated(cfg, opts);
  const rel = await writeSpecFolder(proj, specsDir, { feature, result, validation, cfg });
  console.log('\n' + c.green('✓ ' + t('specWritten', rel)));
  console.log('\n' + c.bold(t('handoff')) + '\n');
  console.log(c.cyan(handoffCommand(rel, equippedSkills, specLang)) + '\n');
}
