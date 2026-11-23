// lib/commands/mutationstep.mjs — el paso de `chalc init` que deja lista la mutación (spec 027, R5–R8).
// Responsabilidad ÚNICA: decidir si se instala la herramienta del stack, hacerlo y contar qué pasó. Razón de
// cambio: cuándo se ofrece y cómo se informa. Qué falta lo sabe `mutationsetup.mjs`.
//
// No imprime: devuelve las líneas ya traducidas, como el paso de la guarda. Y nunca aborta el `init`: un
// proyecto creado sin mutación sigue siendo un proyecto creado; el portón dirá después qué instalar.

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { t } from '../i18n.mjs';
import { detectContext } from '../detect.mjs';
import { installStep, mutationPlan } from '../mutationsetup.mjs';
import { c } from './context.mjs';
import { repoTools } from './equip.mjs';

/**
 * Qué se pide: `true` instalar, `false` no, `null` sin decisión. El flag manda; sin él solo pregunta quien
 * tiene `prompter` (init interactivo), con «sí» por defecto.
 */
export async function mutationWanted({ flag, prompter } = {}) {
  if (typeof flag === 'boolean') return flag;
  return prompter ? prompter.yesno(t('initMutationQ'), true) : null;
}

// Instala si falta y, con la herramienta en su sitio, deja la configuración que no exista.
async function install(projectPath, plan, runStep) {
  const lines = [];
  let ready = plan.installed;
  if (!ready) {
    ready = (await runStep(installStep(plan.install))).code === 0;
    lines.push(t(ready ? 'initMutationInstalled' : 'initMutationFailed', plan.install));
  }
  if (ready && plan.configMissing) {
    await writeFile(join(projectPath, plan.configFile), `${plan.config}\n`, 'utf8');
    lines.push(t('initMutationConfig', plan.configFile));
  }
  return lines;
}

/**
 * Cumple `want` en `projectPath` y devuelve las líneas a mostrar. `tools` son las herramientas resueltas del
 * repo y `runStep` ejecuta un paso `{ command, args, cwd }`. En dry-run solo describe.
 */
export async function runMutationStep(projectPath, { want, dryRun, tools, runStep }) {
  if (want === false) return [];
  if (dryRun) return want ? [t('initMutationDry')] : [];
  const plan = mutationPlan(projectPath, tools);
  if (!plan) return [];
  if (want) return install(projectPath, plan, runStep);
  // Sin decisión (sin terminal ni flag) no se ejecuta una instalación por sorpresa: se dice cómo pedirla.
  return plan.installed ? [] : [t('initMutationHint', plan.install)];
}

/**
 * El paso tal como lo muestra `chalc init`: en dry-run, una línea más de lo que se haría (el proyecto aún no
 * existe, así que no se mira); al crear, lo que pasó sobre el proyecto ya equipado. `print` es para tests.
 */
export async function printInitMutation(dest, { want, dryRun, runStep }, print = console.log) {
  const tools = dryRun ? null : (await repoTools(dest, await detectContext(dest))).tools;
  for (const line of await runMutationStep(dest, { want, dryRun, tools, runStep })) {
    print(dryRun ? c.dim(`  ▶ ${line}`) : `  ${c.cyan('•')} ${line}`);
  }
}
