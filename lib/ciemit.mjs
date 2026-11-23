// lib/ciemit.mjs — el workflow de CI de un repo equipado (spec 029, R10, R12). Responsabilidad ÚNICA: dejar
// `.github/workflows/chalc.yml`. Razón de cambio: qué corre en CI y dónde vive el workflow.
//
// Solo si el usuario lo pide (`--ci`): un workflow se ejecuta solo y va commiteado, así que imponerlo sería
// decidir por todo el que clone el repo. Un archivo con ese nombre sin la marca de chalc es del usuario: se
// respalda antes de reemplazarlo.

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MANAGED_MARK } from './targetkit/formats.mjs';
import { backupBeforeReplace } from './userdata.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'catalog', 'ci', 'chalc.yml');

export const CI_WORKFLOW_REL = '.github/workflows/chalc.yml';

/** Escribe el workflow en `projectPath`. Devuelve su ruta relativa. */
export async function emitCi(projectPath) {
  const dest = join(projectPath, ...CI_WORKFLOW_REL.split('/'));
  if (existsSync(dest) && !(await readFile(dest, 'utf8')).includes(MANAGED_MARK)) await backupBeforeReplace(projectPath, dest, 'replaced');
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, (await readFile(SOURCE, 'utf8')).replace(/\r\n/g, '\n'), 'utf8');
  return CI_WORKFLOW_REL;
}
