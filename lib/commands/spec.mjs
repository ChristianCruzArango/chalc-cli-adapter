// Comando `chalc spec` (carpeta/plantilla vacía specs/NNN-feature) y helpers de scaffold de spec
// compartidos con el orquestador full-stack (feature).

import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { t } from '../i18n.mjs';
import { writeKeepingPrevious } from '../userdata.mjs';
import { detectContext, matchRules } from '../detect.mjs';
import { nextNumber, resolveFeatureFolder } from '../specfolder.mjs';
import { METHODS_DIR, c, cleanPath, disp, flags, interactive, projectPath, specArgs, specProjectArg } from './context.mjs';
import { langCode, slugifyFeatureName, loadRules } from './catalogstore.mjs';
import { makePrompter } from './prompter.mjs';
import { ensureSddScaffold } from './equip.mjs';
import { acquireUserStory } from './storyinput.mjs';
import { hasStorySource, renderHu, sourceLabel, titleOf } from '../hufile.mjs';
import { listConcepts, loadConcepts } from '../../catalog/memory/lib/concepts.mjs';

// ---------- comando: chalc spec ----------
// Sin plantilla en el repo, el usuario elige con qué andamiaje SDD se crea.

// `design.md` y `probes.json` no se copian a la carpeta nueva (specs 038, 041): solo existen en una spec con
// interfaz o con superficie api/cli, y se escriben desde la plantilla. Copiarla siempre dejaría una plantilla sin rellenar sellada con cada spec.
const ONLY_WHEN_NEEDED = new Set(['design.md', 'probes.json']);
const notDesign = (source) => !ONLY_WHEN_NEEDED.has(basename(source));

async function askSpecMode(prompter) {
  const modes = [
    { label: 'lite — constitution + spec + plan + tasks', value: 'lite' },
    { label: 'full — + research, data-model, contracts, quickstart', value: 'full' }
  ];
  return modes[await prompter.select(t('specScaffoldQ'), modes, 0)].value;
}

// La HU de la fuente que dan los flags (`--azure`, `--jira`, `--url`, `--doc`), o '' sin fuente (spec 024, R27).
// Se trae ANTES de crear nada: si la fuente falla, no queda una carpeta a medias. Sin ningún modelo de IA, y
// la credencial la toma `acquireUserStory` del entorno o de su flag, sin imprimirla ni guardarla (R28).
async function storyFromFlags() {
  if (!hasStorySource(flags)) return '';
  const story = await acquireUserStory(null);
  if (!String(story).trim()) throw new Error(t('specHuEmpty', sourceLabel(flags)));
  return story;
}

// Deja la HU tal cual en el `hu.md` de la carpeta recién creada, con su línea de origen.
async function writeHu(featureDir, story) {
  const file = join(featureDir, 'hu.md');
  const template = existsSync(file) ? await readFile(file, 'utf8') : '';
  await writeFile(file, renderHu({ template, text: story, source: sourceLabel(flags), title: titleOf(story) }), 'utf8');
  console.log(c.green(`✓ ${t('specHuWritten', file, sourceLabel(flags))}`));
}

// La ruta del proyecto y el nombre de la carpeta: preguntando en una terminal; si no, los de la línea de comandos.
async function projectAndName(prompter, { proj, featureName }) {
  if (!prompter) {
    console.log('\n' + c.bold('⚙️  chalc spec') + c.dim(`  ·  ${disp(proj)}`) + '\n');
    if (!featureName) throw new Error(t('specUsage'));
    return { proj, featureName };
  }
  console.log('\n' + c.bold('⚙️  chalc spec') + '\n');
  const answer = await prompter.text(t('qaPathQ', c.dim(`[${proj}]`)));
  let name = featureName;
  while (!name) name = await prompter.text(t('specFolderNameQ'));
  return { proj: answer ? resolve(cleanPath(answer)) : proj, featureName: name };
}

export async function runSpec() {
  let proj = projectPath;
  const story = await storyFromFlags();
  let featureName = flags.name ? String(flags.name) : (specProjectArg ? specArgs.slice(0, -1).join(' ') : specArgs.join(' '));
  // Con una HU en la mano y sin nombre, la carpeta se llama como su título.
  featureName = featureName || titleOf(story);
  const prompter = interactive ? makePrompter() : null;
  ({ proj, featureName } = await projectAndName(prompter, { proj, featureName }));
  if (!existsSync(proj)) { if (prompter) prompter.close(); throw new Error(t('pathMissing', proj)); }

  const mode = prompter && !existsSync(join(proj, 'specs', '_template'))
    ? await askSpecMode(prompter)
    : String(flags.mode || 'lite');
  if (!['lite', 'full'].includes(mode)) { if (prompter) prompter.close(); throw new Error(t('specModeInvalid', mode)); }

  const specsDir = await ensureSddScaffold(proj, mode);
  const slug = slugifyFeatureName(featureName);
  const number = await nextNumber(specsDir);
  const featureDir = join(specsDir, `${number}-${slug}`);
  if (existsSync(featureDir)) { if (prompter) prompter.close(); throw new Error(t('specAlreadyExists', featureDir)); }

  const templateDir = join(specsDir, '_template');
  if (!existsSync(templateDir)) { if (prompter) prompter.close(); throw new Error(t('specNoTemplate', templateDir)); }
  await cp(templateDir, featureDir, { recursive: true, dereference: true, force: false, filter: notDesign });

  if (prompter) prompter.close();
  console.log(c.green(`✓ ${t('specCreated', featureDir)}`));
  if (story) await writeHu(featureDir, story);
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
  // Los conceptos que la memoria del repo ya usa (spec 015, R9): la spec generada nombra los suyos
  // con el mismo vocabulario.
  const concepts = listConcepts(await loadConcepts(proj));
  return { templates, constitution, specsDir, concepts };
}

// Etiqueta del stack de un repo (las reglas que aplican, sin la global). '' si no reconoce nada.
export async function detectStackLabel(dir) {
  const matched = matchRules(await loadRules(), await detectContext(dir)).filter((r) => !r.always);
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
  // Reescribir una spec existente respalda antes su versión anterior: `tasks.md` lleva las casillas
  // marcadas, que son el progreso que leen el dashboard y el advisor. Lo que solo trae la plantilla
  // recién copiada no es del usuario: eso se reemplaza sin respaldo.
  const existed = new Set(Object.keys(files).filter((name) => existsSync(join(dest, name))));
  const tplSrc = join(proj, 'specs', '_template');
  if (existsSync(tplSrc)) await cp(tplSrc, dest, { recursive: true, force: false, errorOnExist: false, dereference: true, filter: notDesign });
  for (const [name, content] of Object.entries(files)) {
    const text = String(content).replace(/\s*$/, '') + '\n';
    if (existed.has(name)) await writeKeepingPrevious(proj, join(dest, name), text);
    else await writeFile(join(dest, name), text);
  }
  return { rel, dest, id: folder.name, reused: folder.reused };
}
