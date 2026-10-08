// Lo que comparten los dos caminos de `chalc feature` (repos tal cual y workspaces con worktrees):
// leer el estado equipado de cada repo, preparar las entradas del orquestador y dejar el contrato
// escrito junto a cada spec.

import { mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { t } from '../i18n.mjs';
import { writeKeepingPrevious } from '../userdata.mjs';
import { writeContractLock } from '../specfolder.mjs';
import { slugify } from '../slug.mjs';
import { flags } from './context.mjs';
import { sddModeOf } from './catalogstore.mjs';
import { loadSpecScaffold } from './spec.mjs';
import { SIDE } from '../sides.mjs';
import { readJsonOrKeepSync } from '../userdata.mjs';

// La etiqueta visible de un lado; la del móvil va por t() (paridad es/en).
export const sideLabel = (name) => (name === SIDE.MOBILE ? t('sideMobile') : name);

// Lee el target/modo SDD equipados de un repo (.chalc.json); defaults conservadores.
// Uno ilegible se respalda y se avisa (lib/userdata.mjs).
export const readTarget = (p) => readJsonOrKeepSync(join(p, '.chalc.json'), {}).target || 'claude';
const readMode = (p) => sddModeOf(readJsonOrKeepSync(join(p, '.chalc.json'), {}));

// Modo SDD: --full/--mode mandan; si no, lee el modo ACTUAL del back y pregunta si cambiarlo.
export async function askSddMode(prompter, backPath) {
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

// Contexto del back para el contrato: su docs/architecture.md, si existe.
export async function backContextOf(backPath) {
  const file = join(backPath, 'docs', 'architecture.md');
  return existsSync(file) ? readFile(file, 'utf8') : '';
}

// Las entradas del orquestador por lado: stack, plantillas, constitución y conceptos. Las plantillas
// salen del repo si está equipado; si no, del catálogo en el idioma del spec.
export async function orchestratorSides({ backPath, frontPath, mobilePath, backStack, frontStack, mobileStack }, mode, specLang) {
  const side = async (path, stack) => {
    const { templates, constitution, concepts } = await loadSpecScaffold(path, mode, specLang);
    return { stack, templates, constitution, concepts };
  };
  return {
    back: await side(backPath, backStack),
    front: await side(frontPath, frontStack),
    mobile: mobilePath ? await side(mobilePath, mobileStack) : null
  };
}

// El slug de la feature que propuso la IA, saneado para carpetas y ramas.
export function featureSlug(result) {
  return slugify(result.front.feature || result.back.feature || 'feature') || 'feature';
}

// El contrato junto a la spec (contracts/api.md) y su lock: spec/plan/tasks nunca quedan
// desincronizados del contrato que los originó. `root` es la raíz del repo (política de respaldo).
export async function writeContract(out, root, contract, lock) {
  await mkdir(join(out.dest, 'contracts'), { recursive: true });
  await writeKeepingPrevious(root, join(out.dest, 'contracts', 'api.md'), contract.replace(/\s*$/, '') + '\n');
  await writeContractLock(out.dest, lock);
}
