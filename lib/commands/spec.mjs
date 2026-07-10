// Comando `chalc spec` (carpeta/plantilla vacía specs/NNN-feature) y helpers de scaffold de spec
// compartidos con el orquestador full-stack (feature).

import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { t } from '../i18n.mjs';
import { detectContext, matchRules } from '../detect.mjs';
import { nextNumber, resolveFeatureFolder } from '../specfolder.mjs';
import { METHODS_DIR, RULES_DIR, c, cleanPath, disp, flags, interactive, projectPath, specArgs, specProjectArg } from './context.mjs';
import { langCode, loadJsonDir, slugifyFeatureName } from './catalogstore.mjs';
import { makePrompter } from './prompter.mjs';
import { ensureSddScaffold } from './equip.mjs';

// ---------- comando: chalc spec ----------
export async function runSpec() {
  let proj = projectPath;
  let featureName = flags.name ? String(flags.name) : (specProjectArg ? specArgs.slice(0, -1).join(' ') : specArgs.join(' '));
  const prompter = interactive ? makePrompter() : null;

  if (prompter) {
    console.log('\n' + c.bold('⚙️  chalc spec') + '\n');
    const ans = await prompter.text(t('qaPathQ', c.dim(`[${proj}]`)));
    if (ans) proj = resolve(cleanPath(ans));
    while (!featureName) {
      featureName = await prompter.text(t('specFolderNameQ'));
    }
  } else {
    console.log('\n' + c.bold('⚙️  chalc spec') + c.dim(`  ·  ${disp(proj)}`) + '\n');
    if (!featureName) throw new Error(t('specUsage'));
  }
  if (!existsSync(proj)) { if (prompter) prompter.close(); throw new Error(t('pathMissing', proj)); }

  let mode = String(flags.mode || 'lite');
  if (prompter && !existsSync(join(proj, 'specs', '_template'))) {
    const modes = [
      { label: 'lite — constitution + spec + plan + tasks', value: 'lite' },
      { label: 'full — + research, data-model, contracts, quickstart', value: 'full' }
    ];
    mode = modes[await prompter.select(t('specScaffoldQ'), modes, 0)].value;
  }
  if (!['lite', 'full'].includes(mode)) { if (prompter) prompter.close(); throw new Error(t('specModeInvalid', mode)); }

  const specsDir = await ensureSddScaffold(proj, mode);
  const slug = slugifyFeatureName(featureName);
  const number = await nextNumber(specsDir);
  const featureDir = join(specsDir, `${number}-${slug}`);
  if (existsSync(featureDir)) { if (prompter) prompter.close(); throw new Error(t('specAlreadyExists', featureDir)); }

  const templateDir = join(specsDir, '_template');
  if (!existsSync(templateDir)) { if (prompter) prompter.close(); throw new Error(t('specNoTemplate', templateDir)); }
  await cp(templateDir, featureDir, { recursive: true, dereference: true, force: false });

  if (prompter) prompter.close();
  console.log(c.green(`✓ ${t('specCreated', featureDir)}`));
  console.log(c.dim('  ' + t('specOfficialPath')));
  console.log(c.dim('  ' + t('specNoWrite')));
  console.log(c.dim('  ' + t('specRealNote') + '\n'));
}

// Carga plantillas + constitución de un proyecto (del repo si existen; si no, del catálogo en el idioma del spec).
export async function loadSpecScaffold(proj, mode, specLang) {
  const specsDir = join(proj, 'specs');
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
  return { templates, constitution, specsDir };
}

// Etiqueta del stack de un repo (las reglas que aplican, sin la global). '' si no reconoce nada.
export async function detectStackLabel(dir) {
  const matched = matchRules(await loadJsonDir(RULES_DIR), await detectContext(dir)).filter((r) => !r.always);
  return matched.map((r) => r.name).join(' + ');
}

// Escribe la spec de un lado en specs/NNN-slug/. En full, copia primero las plantillas del modo
// (data-model/research/contracts/quickstart) y luego sobreescribe spec/plan/tasks con lo que generó la IA.
export async function writeSideSpec(proj, slug, files, preferredNum = null) {
  // Idempotente: si ya existe carpeta para este slug se REÚSA (no se crea NNN+1 duplicado);
  // si es nueva, usa el número compartido entre repos (preferredNum) para alinear front/back.
  const folder = await resolveFeatureFolder(join(proj, 'specs'), slug, preferredNum);
  const rel = join('specs', folder.name);
  const dest = join(proj, rel);
  await mkdir(dest, { recursive: true });
  const tplSrc = join(proj, 'specs', '_template');
  if (existsSync(tplSrc)) await cp(tplSrc, dest, { recursive: true, force: false, errorOnExist: false, dereference: true });
  for (const [name, content] of Object.entries(files)) await writeFile(join(dest, name), String(content).replace(/\s*$/, '') + '\n');
  return { rel, dest, id: folder.name, reused: folder.reused };
}
