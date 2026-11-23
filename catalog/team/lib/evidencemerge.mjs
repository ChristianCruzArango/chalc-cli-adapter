// evidencemerge.mjs — unir la evidencia del portón sin conflicto (spec 035, R4). Responsabilidad ÚNICA: enseñar
// a git cómo se unen esos archivos. Razón de cambio: qué evidencia escriben todas las ramas.
//
// Este archivo lo emite chalc dentro de `.chalc/team/lib/`. No edites aquí: se regenera al equipar el repo.
//
// Todas las ramas del equipo escriben los mismos archivos de evidencia. Eso no es un conflicto de trabajo: las
// bitácoras se suman y el informe del portón se reescribe en la siguiente corrida. Sin esto, cada unión —la
// integración, o un desarrollador trayendo lo integrado— pararía a pedirle a alguien que resuelva lo que no importa.

import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { git } from './git.mjs';

// Bitácoras que solo crecen: git suma lo de las dos ramas.
const UNION = Object.freeze(['.chalc/review.md', '.chalc/tdd.jsonl']);
// El último informe del portón: no se mezcla. Cada rama conserva el suyo, que la próxima corrida reescribe.
const REGENERATED = Object.freeze(['.chalc/gate.md', '.chalc/gate.state.json']);
const KEEP_DRIVER = 'chalc-keep';

/**
 * Enseña a git a unir la evidencia del portón sin conflicto, en CUALQUIER unión del repo: la integración y
 * también cuando un desarrollador trae lo integrado a su rama. Es configuración local del repo: no se commitea.
 */
export async function evidenceMerges(root) {
  git(root, ['config', `merge.${KEEP_DRIVER}.driver`, 'true']);
  const file = join(resolve(root, git(root, ['rev-parse', '--git-common-dir']).out), 'info', 'attributes');
  const current = await readFile(file, 'utf8').catch(() => '');
  const wanted = [...UNION.map((path) => `${path} merge=union`), ...REGENERATED.map((path) => `${path} merge=${KEEP_DRIVER}`)];
  const missing = wanted.filter((line) => !current.split(/\r?\n/).includes(line));
  if (!missing.length) return;
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, `${current && !current.endsWith('\n') ? '\n' : ''}${missing.join('\n')}\n`, 'utf8');
}
